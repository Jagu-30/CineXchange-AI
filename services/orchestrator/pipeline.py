"""The 10-step happy path.

An explicit sequence of agent tool calls. Deliberately not one large prompt
pretending to be five agents - each numbered step below is a real network hop.
"""
import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Approval, Booking, Offer, Production, Requirement
from cinex.db.session import session_scope
from cinex.logging import get_logger
from cinex.mcp_client import AgentUnavailable, get_agents
from cinex.steps import emit_step

log = get_logger("orchestrator")
ACTOR = "orchestrator"

STEPS: tuple[tuple[int, str], ...] = (
    (1, "ingest"),
    (2, "decompose"),
    (3, "discover"),
    (4, "solicit"),
    (5, "shortlist"),
    (6, "negotiate"),
    (7, "total"),
    (8, "compliance"),
    (9, "approval_gate"),
    (10, "book"),
)
_NAMES = dict(STEPS)


async def _set_status(production_id: uuid.UUID, status: str, step: int | None = None) -> None:
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one()
        production.status = status
        if step is not None:
            production.current_step = step


async def _step(production_id: uuid.UUID, number: int, status: str, detail: dict | None = None) -> None:
    async with session_scope() as session:
        await emit_step(session, production_id, number, _NAMES[number], status, detail)


async def create_bookings(session, production_id: uuid.UUID) -> list[Booking]:
    """Turn every winning offer into a confirmed booking. Idempotent."""
    requirement_ids = (await session.execute(
        select(Requirement.id).where(Requirement.production_id == production_id)
    )).scalars().all()
    winners = (await session.execute(
        select(Offer).where(Offer.requirement_id.in_(requirement_ids), Offer.is_winner.is_(True))
    )).scalars().all()
    already = set((await session.execute(
        select(Booking.offer_id).where(Booking.production_id == production_id)
    )).scalars().all())

    made = []
    for offer in winners:
        if offer.id in already:
            continue
        booking = Booking(production_id=production_id, offer_id=offer.id,
                          final_price=offer.price, status="confirmed")
        session.add(booking)
        await session.flush()
        made.append(booking)
    return made


async def _total_cost(session, production_id: uuid.UUID) -> Decimal:
    requirement_ids = (await session.execute(
        select(Requirement.id).where(Requirement.production_id == production_id)
    )).scalars().all()
    winners = (await session.execute(
        select(Offer.price).where(Offer.requirement_id.in_(requirement_ids), Offer.is_winner.is_(True))
    )).scalars().all()
    return sum(winners, Decimal("0"))


async def run_happy_path(production_id: uuid.UUID) -> None:
    agents = get_agents()
    settings = get_settings()
    current = 1
    try:
        # 1 - ingest
        await _step(production_id, 1, "in_progress")
        async with session_scope() as session:
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            brief = {
                "text": production.brief_text,
                "budget_cap": str(production.budget_cap),
                "location": production.location,
                "start_date": production.start_date.isoformat(),
                "end_date": production.end_date.isoformat(),
            }
            budget_cap = production.budget_cap
        await _step(production_id, 1, "done", {"brief_chars": len(brief["text"])})

        # 2 - decompose
        current = 2
        await _set_status(production_id, "decomposing", 2)
        await _step(production_id, 2, "in_progress")
        decomposed = await agents.call("producer", "decompose_brief",
                                       {"production_id": str(production_id), **brief})
        requirements = decomposed["requirements"]
        await _step(production_id, 2, "done", {"requirements": len(requirements)})

        # 3, 4, 5 - discover, solicit, shortlist (one Scout call covers all three)
        current = 3
        await _set_status(production_id, "scouting", 3)
        for number in (3, 4, 5):
            await _step(production_id, number, "in_progress")

        scouted = await asyncio.gather(*[
            agents.call("scout", "find_vendors", {"requirement_id": r["requirement_id"]})
            for r in requirements
        ])
        offers_by_requirement = {
            r["requirement_id"]: s["offers"] for r, s in zip(requirements, scouted)
        }
        total_offers = sum(len(v) for v in offers_by_requirement.values())
        await _step(production_id, 3, "done", {"requirements_scouted": len(requirements)})
        await _step(production_id, 4, "done", {"offers": total_offers})
        await _step(production_id, 5, "done", {
            "shortlisted": {k: len(v) for k, v in offers_by_requirement.items()}
        })

        # 6 - negotiate, concurrent across requirements
        current = 6
        await _set_status(production_id, "negotiating", 6)
        await _step(production_id, 6, "in_progress")
        negotiated = await asyncio.gather(*[
            agents.call("negotiation", "negotiate", {
                "requirement_id": requirement_id,
                "offer_ids": [o["offer_id"] for o in offers],
                "max_rounds": settings.negotiation_max_rounds,
            })
            for requirement_id, offers in offers_by_requirement.items()
            if offers
        ])
        await _step(production_id, 6, "done", {
            "negotiated": len(negotiated),
            "rounds": sum(len(n.get("rounds", [])) for n in negotiated),
        })

        # 7 - total
        current = 7
        await _step(production_id, 7, "in_progress")
        async with session_scope() as session:
            total = await _total_cost(session, production_id)
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            production.total_cost = total
            production.current_step = 7
            await write_audit(session, actor=ACTOR, action="compute_total",
                              entity_type="production", entity_id=production_id,
                              payload={"total_cost": total, "budget_cap": budget_cap})
        await _step(production_id, 7, "done", {"total_cost": str(total),
                                               "budget_cap": str(budget_cap)})

        # 8 - compliance
        current = 8
        await _set_status(production_id, "compliance", 8)
        await _step(production_id, 8, "in_progress")
        compliance = await agents.call("compliance", "check_compliance",
                                       {"production_id": str(production_id)})
        await _step(production_id, 8, "done", {"overall": compliance["overall"],
                                               "checks": len(compliance["checks"])})

        # 9 - approval gate
        current = 9
        await _step(production_id, 9, "in_progress")
        from services.compliance_agent.rules import evaluate_approval
        decision = evaluate_approval(
            total_cost=total,
            budget_cap=budget_cap,
            baseline=budget_cap,
            check_statuses=[c["status"] for c in compliance["checks"]],
            threshold_pct=settings.approval_threshold_pct,
        )
        if decision.required:
            approval = await agents.call("compliance", "request_approval", {
                "production_id": str(production_id),
                "reason": ",".join(decision.reasons),
                "delta_amount": str(decision.delta_amount),
                "threshold_breached": decision.threshold_breached,
            })
            await _set_status(production_id, "awaiting_approval", 9)
            await _step(production_id, 9, "done", {
                "approval_required": True, "approval_id": approval["approval_id"],
                "reasons": decision.reasons, "delta_amount": str(decision.delta_amount),
                "delta_pct": round(decision.delta_pct, 2),
            })
            await _step(production_id, 9, "in_progress", {"waiting_on": "producer"})
            log.info("parked_for_approval", extra={"production_id": str(production_id)})
            return
        await _step(production_id, 9, "done", {"approval_required": False})

        # 10 - book
        await _book(production_id)

    except AgentUnavailable as exc:
        await _fail(production_id, current, str(exc))
    except Exception as exc:  # noqa: BLE001 - nothing may fail silently
        log.exception("pipeline_error", extra={"production_id": str(production_id)})
        await _fail(production_id, current, str(exc))


async def _book(production_id: uuid.UUID) -> None:
    await _step(production_id, 10, "in_progress")
    async with session_scope() as session:
        made = await create_bookings(session, production_id)
        total = await _total_cost(session, production_id)
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one()
        production.status = "booked"
        production.current_step = 10
        production.total_cost = total
        await write_audit(session, actor=ACTOR, action="create_bookings",
                          entity_type="production", entity_id=production_id,
                          payload={"bookings": [str(b.id) for b in made], "total_cost": total})
    await _step(production_id, 10, "done", {"bookings": len(made), "total_cost": str(total)})
    # A second, distinct row: the terminal marker the SSE consumer closes the
    # stream on. Deliberately a different status than "done" - both are real
    # audit_log rows (neither is cosmetic), but read_steps' "done, in order"
    # view of the ten canonical steps must see exactly one row per step, so
    # this one is tagged "terminal" rather than re-using "done".
    await _step(production_id, 10, "terminal", {"terminal": "booked"})


async def _fail(production_id: uuid.UUID, step: int, reason: str) -> None:
    await _set_status(production_id, "failed", step)
    async with session_scope() as session:
        await write_audit(session, actor=ACTOR, action="pipeline_failed",
                          entity_type="production", entity_id=production_id,
                          payload={"step": step, "reason": reason})
    await _step(production_id, step, "failed", {"reason": reason})


async def resume_after_approval(production_id: uuid.UUID) -> None:
    """Called once the producer approves. Picks up at step 10 - the brief is
    never resubmitted."""
    await _book(production_id)
