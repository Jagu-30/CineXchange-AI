"""Multi-round negotiation.

Transaction discipline is the load-bearing thing in this file. Every round has
already POSTed to a vendor whose concession ladder is process-local and *not*
transactional, so a round that happened really happened. Holding one
`session_scope()` across the whole offers x rounds cartesian meant one `LLMError`
on the last offer rolled back the audit rows for every decision already taken
against advanced vendor state: real decisions, zero audit. It also pinned a
pooled DB connection for up to ~270s while the orchestrator fans these out
concurrently, which exhausts the pool.

So: no DB session is ever held across an LLM or vendor call. Reads happen in a
short session up front, each round's audit row commits in its own short session
as it happens, and the winner update takes a final short session at the end.
"""
import uuid
from dataclasses import dataclass
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.clickhouse import median_price
from cinex.config import get_settings
from cinex.db.models import Offer, Requirement, Vendor
from cinex.db.session import session_scope
from cinex.http import VendorUnavailable, request_with_retry
from cinex.llm.gemini import get_llm
from cinex.llm.prompts import negotiation as prompts
from cinex.logging import get_logger
from cinex.schemas.agents import NegotiationStrategy

log = get_logger("negotiation-agent")
mcp = FastMCP("negotiation-agent")
AGENT = "negotiation-agent"


@dataclass(frozen=True)
class _Candidate:
    """Everything a round needs, read once so no session is open during the calls."""
    offer_id: uuid.UUID
    price: Decimal
    vendor_id: uuid.UUID
    vendor_name: str
    vendor_rating: Decimal
    vendor_base_price: Decimal
    endpoint: str


async def market_anchor(category: str) -> Decimal:
    """Query 1 from ClickHouse. Falls back to the Postgres median only if the
    analytics store has no history yet."""
    anchor = await median_price(category)
    if anchor > 0:
        return anchor
    async with session_scope() as session:
        prices = (await session.execute(
            select(Vendor.base_price).where(Vendor.category == category)
        )).scalars().all()
    if not prices:
        return Decimal("0")
    return sorted(prices)[len(prices) // 2]


async def _audit(action: str, offer_id: uuid.UUID, payload: dict) -> None:
    """One short transaction per audit row: it is durable the moment it is written."""
    async with session_scope() as session:
        await write_audit(session, actor=AGENT, action=action,
                          entity_type="offer", entity_id=offer_id, payload=payload)


async def _negotiate_one(candidate: _Candidate, category: str,
                         max_rounds: int, anchor: Decimal) -> dict:
    session_id = str(uuid.uuid4())
    url = f"{candidate.endpoint}/vendors/{candidate.vendor_id}/negotiate"

    current_ask = candidate.price
    last_offer = candidate.price
    outcome = {"offer_id": str(candidate.offer_id), "vendor_id": str(candidate.vendor_id),
               "settled": False, "reachable": True, "price": candidate.price, "rounds": []}

    for round_no in range(1, max_rounds + 1):
        prompt = prompts.build(
            category=category, round_no=round_no, max_rounds=max_rounds,
            vendor_name=candidate.vendor_name, rating=str(candidate.vendor_rating),
            current_ask=str(current_ask), last_offer=str(last_offer),
            market_anchor=str(anchor),
        )
        # No session is open here, or below at request_with_retry. That is the point.
        strategy: NegotiationStrategy = await get_llm().generate_json(prompt, NegotiationStrategy)

        if strategy.walk_away:
            await _audit("negotiation_walk_away", candidate.offer_id,
                         {"round": round_no, "rationale": strategy.rationale})
            break

        counter = Decimal(str(strategy.counter_price)).quantize(Decimal("0.01"))
        terms = {t: True for t in strategy.concede_terms}

        try:
            reply = await request_with_retry("POST", url, json={
                "session_id": session_id, "round": round_no,
                "price": str(counter), "terms": terms,
                "base_price": str(candidate.vendor_base_price),
            })
        except VendorUnavailable as exc:
            outcome["reachable"] = False
            await _audit("negotiation_vendor_unavailable", candidate.offer_id,
                         {"round": round_no, "error": str(exc)})
            break

        decision = reply["decision"]
        vendor_price = Decimal(reply["price"])

        # This round's audit row - and the agreed price, if the vendor accepted -
        # commit here, before anything else can raise. A later LLMError can no
        # longer erase the record of a decision the vendor has already acted on.
        async with session_scope() as session:
            await write_audit(
                session, actor=AGENT, action="negotiation_round",
                entity_type="offer", entity_id=candidate.offer_id,
                payload={
                    "round": round_no, "vendor_id": str(candidate.vendor_id),
                    "vendor_name": candidate.vendor_name,
                    "offered": counter, "conceded_terms": strategy.concede_terms,
                    "rationale": strategy.rationale, "decision": decision,
                    "vendor_price": vendor_price, "vendor_message": reply.get("message", ""),
                },
            )
            if decision == "accept":
                offer = (await session.execute(
                    select(Offer).where(Offer.id == candidate.offer_id)
                )).scalar_one()
                offer.price = vendor_price
                offer.terms = {**offer.terms, **terms}

        outcome["rounds"].append({
            "round": round_no, "offered": str(counter), "decision": decision,
            "vendor_price": str(vendor_price), "rationale": strategy.rationale,
        })

        last_offer = counter
        if decision == "accept":
            outcome.update(settled=True, price=vendor_price)
            break
        if decision == "reject":
            break
        current_ask = vendor_price

    async with session_scope() as session:
        offer = (await session.execute(
            select(Offer).where(Offer.id == candidate.offer_id)
        )).scalar_one()
        offer.round = len(outcome["rounds"])
        offer.status = "negotiated"
    return outcome


def pick_winner(outcomes: list[dict]) -> dict:
    """Best settled offer; only if none settled, the best standing one.

    Three tiers rather than two. A vendor that went dark mid-negotiation leaves
    an unsettled outcome carrying its *original* quote, which under a flat
    min(price) could beat every vendor that actually talked to us - and then get
    booked. An unreachable vendor is therefore last resort, never a bargain.
    """
    if not outcomes:
        raise ValueError("no offers to negotiate")
    tiers = (
        [o for o in outcomes if o["settled"]],
        [o for o in outcomes if not o["settled"] and o.get("reachable", True)],
        outcomes,
    )
    for pool in tiers:
        if pool:
            return min(pool, key=lambda o: o["price"])
    raise ValueError("no offers to negotiate")  # pragma: no cover - tiers[2] is outcomes


async def _negotiate(requirement_id: str, offer_ids: list[str], max_rounds: int | None = None) -> dict:
    rounds_cap = max_rounds or get_settings().negotiation_max_rounds
    rid = uuid.UUID(requirement_id)
    wanted = [uuid.UUID(o) for o in offer_ids]

    # Short read session: snapshot what the network phase needs, then let go of
    # the connection before the first LLM call.
    async with session_scope() as session:
        requirement = (await session.execute(
            select(Requirement).where(Requirement.id == rid)
        )).scalar_one()
        offers = (await session.execute(
            select(Offer).where(Offer.id.in_(wanted))
        )).scalars().all()
        vendors = {
            v.id: v for v in (await session.execute(
                select(Vendor).where(Vendor.id.in_([o.vendor_id for o in offers]))
            )).scalars().all()
        }
        category = requirement.category
        candidates = [
            _Candidate(
                offer_id=o.id, price=o.price, vendor_id=o.vendor_id,
                vendor_name=vendors[o.vendor_id].name,
                vendor_rating=vendors[o.vendor_id].rating,
                vendor_base_price=vendors[o.vendor_id].base_price,
                endpoint=vendors[o.vendor_id].contact_meta["endpoint"],
            )
            for o in offers
        ]

    anchor = await market_anchor(category)

    outcomes: list[dict] = []
    try:
        for candidate in candidates:
            outcomes.append(await _negotiate_one(candidate, category, rounds_cap, anchor))

        best = pick_winner(outcomes)

        async with session_scope() as session:
            offers = (await session.execute(
                select(Offer).where(Offer.id.in_(wanted))
            )).scalars().all()
            for offer in offers:
                if str(offer.id) == best["offer_id"]:
                    offer.status, offer.is_winner = "accepted", True
                else:
                    offer.status, offer.is_winner = "rejected", False

            await write_audit(
                session, actor=AGENT, action="negotiate",
                entity_type="requirement", entity_id=rid,
                payload={"max_rounds": rounds_cap, "anchor": anchor,
                         "winner": best["offer_id"], "final_price": best["price"],
                         "settled": best["settled"],
                         "settled_count": len([o for o in outcomes if o["settled"]]),
                         "outcomes": outcomes},
            )
    except Exception as exc:  # noqa: BLE001 - nothing may fail silently
        # The per-round rows are already committed; this row says where it stopped.
        async with session_scope() as session:
            await write_audit(
                session, actor=AGENT, action="negotiate_failed",
                entity_type="requirement", entity_id=rid,
                payload={"error": str(exc), "completed_offers": len(outcomes),
                         "completed_rounds": sum(len(o["rounds"]) for o in outcomes)},
            )
        raise

    return {
        "winning_offer_id": best["offer_id"],
        "final_price": str(best["price"]),
        "settled": best["settled"],
        "rounds": [r for o in outcomes for r in o["rounds"]],
    }


@mcp.tool
async def negotiate(requirement_id: str, offer_ids: list[str], max_rounds: int | None = None) -> dict:
    """Run multi-round negotiation against every candidate vendor and pick a winner."""
    return await _negotiate(requirement_id, offer_ids, max_rounds)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Negotiation Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
