"""The 7-step emergency recovery machine.

Steps 1 and 2 re-invoke Scout and Negotiation over MCP - the same agents the
happy path uses. Nothing here re-reads the original brief; the requirement rows
already exist, which is the whole point of the demo beat.

Transaction discipline: every step commits its own timeline entry and audit row
as it completes, and the whole body is wrapped so that *any* exception lands the
event in `failed`. That matters more here than anywhere else in the system,
because `in_progress` and `awaiting_approval` are inside the predicate of the
partial unique index `uq_recovery_active_per_production`: an event stranded in
either state is a permanent lockout on every future recovery for that
production. The guard exists to stop a fumbled re-trigger forking state, not to
block the retry path.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.costing import total_cost
from cinex.db.models import (
    Booking, ComplianceCheck, Offer, Production, RecoveryEvent, Requirement, Vendor,
)
from cinex.db.session import session_scope
from cinex.logging import get_logger
from cinex.mcp_client import get_agents
from services.compliance_agent.rules import check_insurance, check_permit, evaluate_approval
from services.recovery_agent.schedule import find_collisions

log = get_logger("recovery-agent")
mcp = FastMCP("recovery-agent")
AGENT = "recovery-agent"
ACTIVE = ("pending", "in_progress", "awaiting_approval")

STEP_NAMES = {
    1: "find_replacement",
    2: "negotiate_replacement",
    3: "recalculate_cost",
    4: "check_schedule",
    5: "update_records",
    6: "present_diff",
    7: "approval_gate",
}


async def _append_in(session, event_id: uuid.UUID, step: int, detail: dict,
                     name: str | None = None) -> list:
    entry = {
        "step": step,
        "name": name or STEP_NAMES[step],
        "ts": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
    }
    event = (await session.execute(
        select(RecoveryEvent).where(RecoveryEvent.id == event_id)
    )).scalar_one()
    event.timeline = [*event.timeline, entry]
    await write_audit(
        session, actor=AGENT, action=f"recovery.{entry['name']}",
        entity_type="recovery_event", entity_id=event_id,
        payload={"production_id": str(event.production_id), **entry},
    )
    return event.timeline


async def _append(event_id: uuid.UUID, step: int, detail: dict, *,
                  session=None, name: str | None = None) -> list:
    """Append to the timeline as each step completes, so a crash still leaves an artifact.

    This is now true. Passing `session` folds the entry into a caller's
    transaction when the entry has to be atomic with the rows it describes (the
    booking swap, the approval gate); otherwise it commits on its own, right
    away, and a later failure cannot take it back.
    """
    if session is not None:
        return await _append_in(session, event_id, step, detail, name)
    async with session_scope() as own:
        return await _append_in(own, event_id, step, detail, name)


async def _fail(event_id: uuid.UUID, pid: uuid.UUID, progress: dict, reason: str) -> dict:
    """Land the event in `failed`, audibly, and release the ACTIVE predicate.

    The production goes back to the status it held before recovery started
    (`booked`, in practice). If the swap at step 3 already committed, that is
    still honest: the replacement booking is confirmed and the production is
    booked - just against a different vendor. What must never happen is the
    production being left in the non-terminal `recovering`, or the event being
    left ACTIVE, because either one blocks the retry.
    """
    async with session_scope() as session:
        event = (await session.execute(
            select(RecoveryEvent).where(RecoveryEvent.id == event_id)
        )).scalar_one()
        event.status = "failed"
        prior = progress.get("prior_status")
        if prior:
            production = (await session.execute(
                select(Production).where(Production.id == pid)
            )).scalar_one()
            production.status = prior
        timeline = await _append_in(
            session, event_id, progress.get("step", 1),
            {"error": reason, "production_status": prior}, name="failed",
        )
    log.error("recovery_failed", extra={"production_id": str(pid), "error": reason})
    return {"recovery_event_id": str(event_id), "timeline": timeline, "outcome": "failed"}


async def _active_event(session, pid: uuid.UUID) -> RecoveryEvent | None:
    """The one recovery this production is allowed to have in flight, if any.

    ACTIVE mirrors the predicate of the partial unique index
    uq_recovery_active_per_production - they have to agree or the guard and the
    constraint disagree about what "already recovering" means.
    """
    return (await session.execute(
        select(RecoveryEvent).where(
            RecoveryEvent.production_id == pid, RecoveryEvent.status.in_(ACTIVE)
        )
    )).scalars().first()


async def _open_event(pid: uuid.UUID, bid: uuid.UUID, trigger: str) -> tuple[uuid.UUID | None, dict | None]:
    """Claim the single active recovery slot for this production.

    Returns (event_id, None) on a fresh claim, or (None, short_circuit_body) when
    someone else already holds it.
    """
    async with session_scope() as session:
        existing = await _active_event(session, pid)
        if existing is not None:
            log.info("recovery_already_active", extra={"production_id": str(pid)})
            return None, {"recovery_event_id": str(existing.id), "timeline": existing.timeline,
                          "outcome": "already_in_progress"}

    try:
        async with session_scope() as session:
            event = RecoveryEvent(production_id=pid, trigger=trigger,
                                  affected_booking_id=bid, status="in_progress", timeline=[])
            session.add(event)
            await session.flush()
            return event.id, None
    except IntegrityError:
        # SELECT-then-INSERT is a TOCTOU: two concurrent triggers (a
        # double-clicked demo button) both see no ACTIVE event and both INSERT.
        # uq_recovery_active_per_production correctly rejects the loser at
        # commit - but an unhandled IntegrityError surfaced as a 500 with no
        # audit row. Same answer as the guard path, and it is written down.
        async with session_scope() as session:
            winner = await _active_event(session, pid)
            if winner is None:
                winner = (await session.execute(
                    select(RecoveryEvent)
                    .where(RecoveryEvent.production_id == pid)
                    .order_by(RecoveryEvent.created_at.desc())
                )).scalars().first()
            await write_audit(
                session, actor=AGENT, action="recovery.already_in_progress",
                entity_type="recovery_event",
                entity_id=winner.id if winner is not None else None,
                payload={"production_id": str(pid), "trigger": trigger,
                         "reason": "concurrent trigger lost the unique-index race"},
            )
            body = {
                "recovery_event_id": str(winner.id) if winner is not None else None,
                "timeline": winner.timeline if winner is not None else [],
                "outcome": "already_in_progress",
            }
        log.info("recovery_race_lost", extra={"production_id": str(pid)})
        return None, body


async def _run(pid: uuid.UUID, bid: uuid.UUID, event_id: uuid.UUID, progress: dict) -> dict:
    agents = get_agents()
    settings = get_settings()

    # Context read, and the production is marked `recovering` - one transaction.
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        old_booking = (await session.execute(
            select(Booking).where(Booking.id == bid)
        )).scalar_one()
        old_offer = (await session.execute(
            select(Offer).where(Offer.id == old_booking.offer_id)
        )).scalar_one()
        old_vendor = (await session.execute(
            select(Vendor).where(Vendor.id == old_offer.vendor_id)
        )).scalar_one()
        requirement = (await session.execute(
            select(Requirement).where(Requirement.id == old_offer.requirement_id)
        )).scalar_one()

        # Captured before any mutation - evaluate_approval's recovery baseline.
        old_total = production.total_cost or Decimal("0")
        ctx = {
            "old_booking_id": old_booking.id,
            "old_offer_id": old_offer.id,
            "old_offer_price": old_offer.price,
            "old_vendor_id": old_vendor.id,
            "old_vendor_name": old_vendor.name,
            "requirement_id": requirement.id,
            "requirement_category": requirement.category,
            "location": production.location,
            "start_date": production.start_date,
            "end_date": production.end_date,
            "budget_cap": production.budget_cap,
        }
        progress["prior_status"] = production.status
        production.status = "recovering"

    # 1 - find an equivalent vendor, excluding the one that dropped out
    progress["step"] = 1
    scouted = await agents.call("scout", "find_vendors", {
        "requirement_id": str(ctx["requirement_id"]),
        "exclude_vendor_ids": [str(ctx["old_vendor_id"])],
    })
    candidates = scouted["offers"]
    await _append(event_id, 1, {
        "excluded_vendor": str(ctx["old_vendor_id"]),
        "excluded_vendor_name": ctx["old_vendor_name"],
        "candidates": len(candidates),
        "candidate_names": [c.get("vendor_name") for c in candidates],
    })

    progress["step"] = 2
    if not candidates:
        return await _fail(event_id, pid, progress, "no replacement vendors available")

    # 2 - negotiate with the replacement
    negotiated = await agents.call("negotiation", "negotiate", {
        "requirement_id": str(ctx["requirement_id"]),
        "offer_ids": [c["offer_id"] for c in candidates],
        "max_rounds": settings.negotiation_max_rounds,
    })
    async with session_scope() as session:
        new_offer = (await session.execute(
            select(Offer).where(Offer.id == uuid.UUID(negotiated["winning_offer_id"]))
        )).scalar_one()
        new_vendor = (await session.execute(
            select(Vendor).where(Vendor.id == new_offer.vendor_id)
        )).scalar_one()
        new_offer_id, new_price = new_offer.id, new_offer.price
        new_vendor_name = new_vendor.name
        new_vendor_blocked = new_vendor.availability_calendar.get("blocked", [])
        await _append(event_id, 2, {
            "vendor_name": new_vendor_name,
            "final_price": str(new_price),
            "rounds": len(negotiated.get("rounds", [])),
        }, session=session)

    # 3 - the swap and the timeline entry that describes it, atomically
    progress["step"] = 3
    async with session_scope() as session:
        old_booking = (await session.execute(
            select(Booking).where(Booking.id == bid)
        )).scalar_one()
        old_offer = (await session.execute(
            select(Offer).where(Offer.id == ctx["old_offer_id"])
        )).scalar_one()
        old_booking.status = "superseded"
        old_offer.is_winner = False
        new_booking = Booking(production_id=pid, offer_id=new_offer_id,
                              final_price=new_price, status="confirmed")
        session.add(new_booking)
        await session.flush()
        new_booking_id = new_booking.id

        # One shared definition of total cost (cinex.costing), the same one the
        # happy path's step 7 and step 10 use - so an approved recovery cannot
        # rewrite the number under a different rule than it was approved against.
        new_total = await total_cost(session, pid)
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        production.total_cost = new_total
        delta = new_total - old_total
        await _append(event_id, 3, {
            "old_total": str(old_total), "new_total": str(new_total), "delta": str(delta),
        }, session=session)

    # 4 - schedule impact
    progress["step"] = 4
    collisions = find_collisions(new_vendor_blocked, ctx["start_date"], ctx["end_date"])
    await _append(event_id, 4, {
        "collisions": collisions,
        "window": [ctx["start_date"].isoformat(), ctx["end_date"].isoformat()],
        "impact": "none" if not collisions else f"{len(collisions)} blocked day(s)",
    })

    # 5 - insurance and logistics records against the new vendor
    progress["step"] = 5
    permit = check_permit(ctx["location"], ctx["start_date"], ctx["end_date"],
                          {ctx["requirement_category"]})
    insurance = check_insurance(new_total, settings.insurance_rider_threshold)
    async with session_scope() as session:
        for result in (permit, insurance):
            session.add(ComplianceCheck(production_id=pid, booking_id=new_booking_id,
                                        check_type=result.check_type, status=result.status,
                                        evidence=result.evidence))
        await _append(event_id, 5, {
            "permit": permit.status, "insurance": insurance.status,
            "rebound_to_booking": str(new_booking_id),
        }, session=session)

    # 6 - the producer-facing diff
    progress["step"] = 6
    diff = {
        "old": {"booking_id": str(ctx["old_booking_id"]), "vendor_name": ctx["old_vendor_name"],
                "price": str(ctx["old_offer_price"]), "status": "superseded"},
        "new": {"booking_id": str(new_booking_id), "vendor_name": new_vendor_name,
                "price": str(new_price), "status": "confirmed"},
        "delta": str(delta),
        "schedule_collisions": collisions,
    }
    await _append(event_id, 6, diff)

    # 7 - approval gate, same function the happy path uses, recovery baseline
    progress["step"] = 7
    decision = evaluate_approval(
        total_cost=new_total,
        budget_cap=ctx["budget_cap"],
        baseline=old_total,
        check_statuses=[permit.status, insurance.status],
        threshold_pct=settings.approval_threshold_pct,
    )
    gate = {
        "approval_required": decision.required,
        "reasons": decision.reasons,
        "delta_amount": str(decision.delta_amount),
        "delta_pct": round(decision.delta_pct, 2),
        "threshold_pct": settings.approval_threshold_pct,
    }
    if decision.required:
        approval = await agents.call("compliance", "request_approval", {
            "production_id": str(pid),
            "reason": f"recovery:{','.join(decision.reasons)}",
            "delta_amount": str(decision.delta_amount),
            "threshold_breached": decision.threshold_breached,
        })
        gate["approval_id"] = approval["approval_id"]

    async with session_scope() as session:
        event = (await session.execute(
            select(RecoveryEvent).where(RecoveryEvent.id == event_id)
        )).scalar_one()
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        if decision.required:
            event.status = production.status = outcome = "awaiting_approval"
        else:
            event.status, production.status, outcome = "resolved", "booked", "resolved"
        event.resolution_booking_id = new_booking_id
        timeline = await _append(event_id, 7, gate, session=session)

    log.info("recovery_complete", extra={"production_id": str(pid), "outcome": outcome})
    return {"recovery_event_id": str(event_id), "timeline": timeline, "outcome": outcome}


async def _recover(production_id: str, booking_id: str, trigger: str) -> dict:
    pid, bid = uuid.UUID(production_id), uuid.UUID(booking_id)

    # idempotency: never fork state on a fumbled re-trigger
    event_id, short_circuit = await _open_event(pid, bid, trigger)
    if short_circuit is not None:
        return short_circuit

    progress: dict = {"step": 1, "prior_status": None}
    try:
        return await _run(pid, bid, event_id, progress)
    except Exception as exc:  # noqa: BLE001 - an ACTIVE event is a permanent lockout
        await _fail(event_id, pid, progress, str(exc))
        raise


async def _resolve_recovery(production_id: str, decision: str) -> dict:
    """Close out a recovery the producer has ruled on.

    `recovery_events` is this agent's table, so the orchestrator asks rather than
    writing it directly. Without this, an approved recovery left the event in
    `awaiting_approval` forever - inside the partial unique index predicate, so
    the production was permanently locked out of every future recovery.
    """
    pid = uuid.UUID(production_id)
    async with session_scope() as session:
        event = (await session.execute(
            select(RecoveryEvent)
            .where(RecoveryEvent.production_id == pid,
                   RecoveryEvent.status == "awaiting_approval")
            .order_by(RecoveryEvent.created_at.desc())
        )).scalars().first()
        if event is None:
            await write_audit(
                session, actor=AGENT, action="recovery.resolve_noop",
                entity_type="production", entity_id=pid,
                payload={"production_id": str(pid), "decision": decision,
                         "reason": "no recovery event awaiting approval"},
            )
            return {"recovery_event_id": None, "outcome": "no_active_recovery",
                    "timeline": [], "production_id": production_id}

        approved = decision == "approved"
        resolved_status = "resolved" if approved else "failed"
        event.status = resolved_status
        event_id = event.id
        resolution = str(event.resolution_booking_id) if event.resolution_booking_id else None
        timeline = await _append_in(session, event_id, 7, {
            "producer_decision": decision,
            "recovery_event_status": resolved_status,
            "resolution_booking_id": resolution,
            "note": (
                "producer approved the swap; the replacement booking stands"
                if approved else
                "producer rejected the swap. The replacement booking was already "
                "committed and the vendor already told, so it is left in place and "
                "the production is marked failed for human follow-up - nothing is "
                "silently un-booked."
            ),
        }, name="resolve")

    log.info("recovery_resolved", extra={"production_id": production_id, "decision": decision})
    return {"recovery_event_id": str(event_id), "outcome": resolved_status,
            "timeline": timeline, "production_id": production_id}


@mcp.tool
async def recover(production_id: str, booking_id: str, trigger: str = "vendor_unavailable") -> dict:
    """Run the 7-step recovery for a booking whose vendor has dropped out."""
    return await _recover(production_id, booking_id, trigger)


@mcp.tool
async def resolve_recovery(production_id: str, decision: str) -> dict:
    """Close out a recovery event once the producer has approved or rejected it."""
    return await _resolve_recovery(production_id, decision)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Recovery Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
