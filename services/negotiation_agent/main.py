import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
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


async def market_anchor(category: str) -> Decimal:
    """Median market price. Task 19 replaces this body with the ClickHouse query."""
    async with session_scope() as session:
        prices = (await session.execute(
            select(Vendor.base_price).where(Vendor.category == category)
        )).scalars().all()
    if not prices:
        return Decimal("0")
    ordered = sorted(prices)
    return ordered[len(ordered) // 2]


async def _negotiate_one(session, offer: Offer, vendor: Vendor, requirement: Requirement,
                         max_rounds: int, anchor: Decimal) -> dict:
    session_id = str(uuid.uuid4())
    endpoint = vendor.contact_meta["endpoint"]
    url = f"{endpoint}/vendors/{vendor.id}/negotiate"

    current_ask = offer.price
    last_offer = offer.price
    outcome = {"offer_id": str(offer.id), "vendor_id": str(vendor.id),
               "settled": False, "price": offer.price, "rounds": []}

    for round_no in range(1, max_rounds + 1):
        prompt = prompts.build(
            category=requirement.category, round_no=round_no, max_rounds=max_rounds,
            vendor_name=vendor.name, rating=str(vendor.rating),
            current_ask=str(current_ask), last_offer=str(last_offer),
            market_anchor=str(anchor),
        )
        strategy: NegotiationStrategy = await get_llm().generate_json(prompt, NegotiationStrategy)

        if strategy.walk_away:
            await write_audit(
                session, actor=AGENT, action="negotiation_walk_away",
                entity_type="offer", entity_id=offer.id,
                payload={"round": round_no, "rationale": strategy.rationale},
            )
            break

        counter = Decimal(str(strategy.counter_price)).quantize(Decimal("0.01"))
        terms = {t: True for t in strategy.concede_terms}

        try:
            reply = await request_with_retry("POST", url, json={
                "session_id": session_id, "round": round_no,
                "price": str(counter), "terms": terms,
                "base_price": str(vendor.base_price),
            })
        except VendorUnavailable as exc:
            await write_audit(
                session, actor=AGENT, action="negotiation_vendor_unavailable",
                entity_type="offer", entity_id=offer.id,
                payload={"round": round_no, "error": str(exc)},
            )
            break

        decision = reply["decision"]
        vendor_price = Decimal(reply["price"])

        await write_audit(
            session, actor=AGENT, action="negotiation_round",
            entity_type="offer", entity_id=offer.id,
            payload={
                "round": round_no, "vendor_id": str(vendor.id), "vendor_name": vendor.name,
                "offered": counter, "conceded_terms": strategy.concede_terms,
                "rationale": strategy.rationale, "decision": decision,
                "vendor_price": vendor_price, "vendor_message": reply.get("message", ""),
            },
        )
        outcome["rounds"].append({
            "round": round_no, "offered": str(counter), "decision": decision,
            "vendor_price": str(vendor_price), "rationale": strategy.rationale,
        })

        last_offer = counter
        if decision == "accept":
            outcome.update(settled=True, price=vendor_price)
            offer.price = vendor_price
            offer.terms = {**offer.terms, **terms}
            break
        if decision == "reject":
            break
        current_ask = vendor_price

    offer.round = len(outcome["rounds"])
    offer.status = "negotiated"
    return outcome


async def _negotiate(requirement_id: str, offer_ids: list[str], max_rounds: int | None = None) -> dict:
    rounds_cap = max_rounds or get_settings().negotiation_max_rounds
    rid = uuid.UUID(requirement_id)
    wanted = [uuid.UUID(o) for o in offer_ids]

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
        anchor = await market_anchor(requirement.category)

        outcomes = []
        for offer in offers:
            outcomes.append(
                await _negotiate_one(session, offer, vendors[offer.vendor_id],
                                     requirement, rounds_cap, anchor)
            )

        settled = [o for o in outcomes if o["settled"]]
        pool = settled or outcomes
        best = min(pool, key=lambda o: o["price"])

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
                     "settled_count": len(settled), "outcomes": outcomes},
        )

    return {
        "winning_offer_id": best["offer_id"],
        "final_price": str(best["price"]),
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
