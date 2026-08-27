"""The 7-step emergency recovery machine.

Steps 1 and 2 re-invoke Scout and Negotiation over MCP - the same agents the
happy path uses. Nothing here re-reads the original brief; the requirement rows
already exist, which is the whole point of the demo beat.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Booking, Offer, Production, RecoveryEvent, Requirement, Vendor
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


async def _append(session, event: RecoveryEvent, step: int, detail: dict) -> None:
    """Append to the timeline as each step completes, so a crash still leaves an artifact."""
    entry = {
        "step": step,
        "name": STEP_NAMES[step],
        "ts": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
    }
    event.timeline = [*event.timeline, entry]
    await write_audit(
        session, actor=AGENT, action=f"recovery.{STEP_NAMES[step]}",
        entity_type="recovery_event", entity_id=event.id,
        payload={"production_id": str(event.production_id), **entry},
    )


async def _recover(production_id: str, booking_id: str, trigger: str) -> dict:
    pid, bid = uuid.UUID(production_id), uuid.UUID(booking_id)
    agents = get_agents()
    settings = get_settings()

    # idempotency: never fork state on a fumbled re-trigger
    async with session_scope() as session:
        existing = (await session.execute(
            select(RecoveryEvent).where(
                RecoveryEvent.production_id == pid, RecoveryEvent.status.in_(ACTIVE)
            )
        )).scalars().first()
        if existing is not None:
            log.info("recovery_already_active", extra={"production_id": production_id})
            return {"recovery_event_id": str(existing.id), "timeline": existing.timeline,
                    "outcome": "already_in_progress"}

        event = RecoveryEvent(production_id=pid, trigger=trigger,
                              affected_booking_id=bid, status="in_progress", timeline=[])
        session.add(event)
        await session.flush()
        event_id = event.id

    async with session_scope() as session:
        event = (await session.execute(
            select(RecoveryEvent).where(RecoveryEvent.id == event_id)
        )).scalar_one()
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

        old_total = production.total_cost or Decimal("0")
        production.status = "recovering"

        # 1 - find an equivalent vendor, excluding the one that dropped out
        scouted = await agents.call("scout", "find_vendors", {
            "requirement_id": str(requirement.id),
            "exclude_vendor_ids": [str(old_vendor.id)],
        })
        candidates = scouted["offers"]
        await _append(session, event, 1, {
            "excluded_vendor": str(old_vendor.id),
            "excluded_vendor_name": old_vendor.name,
            "candidates": len(candidates),
            "candidate_names": [c.get("vendor_name") for c in candidates],
        })

        if not candidates:
            event.status = "failed"
            await _append(session, event, 2, {"error": "no replacement vendors available"})
            return {"recovery_event_id": str(event_id), "timeline": event.timeline,
                    "outcome": "failed"}

        # 2 - negotiate with the replacement
        negotiated = await agents.call("negotiation", "negotiate", {
            "requirement_id": str(requirement.id),
            "offer_ids": [c["offer_id"] for c in candidates],
            "max_rounds": settings.negotiation_max_rounds,
        })
        new_offer = (await session.execute(
            select(Offer).where(Offer.id == uuid.UUID(negotiated["winning_offer_id"]))
        )).scalar_one()
        new_vendor = (await session.execute(
            select(Vendor).where(Vendor.id == new_offer.vendor_id)
        )).scalar_one()
        await _append(session, event, 2, {
            "vendor_name": new_vendor.name,
            "final_price": str(new_offer.price),
            "rounds": len(negotiated.get("rounds", [])),
        })

        # 3 - recalculate the total from live DB state
        old_booking.status = "superseded"
        old_offer.is_winner = False
        new_booking = Booking(production_id=pid, offer_id=new_offer.id,
                              final_price=new_offer.price, status="confirmed")
        session.add(new_booking)
        await session.flush()

        confirmed = (await session.execute(
            select(Booking.final_price).where(Booking.production_id == pid,
                                              Booking.status == "confirmed")
        )).scalars().all()
        new_total = sum(confirmed, Decimal("0"))
        production.total_cost = new_total
        delta = new_total - old_total
        await _append(session, event, 3, {
            "old_total": str(old_total), "new_total": str(new_total), "delta": str(delta),
        })

        # 4 - schedule impact
        collisions = find_collisions(
            new_vendor.availability_calendar.get("blocked", []),
            production.start_date, production.end_date,
        )
        await _append(session, event, 4, {
            "collisions": collisions,
            "window": [production.start_date.isoformat(), production.end_date.isoformat()],
            "impact": "none" if not collisions else f"{len(collisions)} blocked day(s)",
        })

        # 5 - insurance and logistics records against the new vendor
        permit = check_permit(production.location, production.start_date,
                              production.end_date, {requirement.category})
        insurance = check_insurance(new_total, settings.insurance_rider_threshold)
        from cinex.db.models import ComplianceCheck
        for result in (permit, insurance):
            session.add(ComplianceCheck(production_id=pid, booking_id=new_booking.id,
                                        check_type=result.check_type, status=result.status,
                                        evidence=result.evidence))
        await _append(session, event, 5, {
            "permit": permit.status, "insurance": insurance.status,
            "rebound_to_booking": str(new_booking.id),
        })

        # 6 - the producer-facing diff
        diff = {
            "old": {"booking_id": str(old_booking.id), "vendor_name": old_vendor.name,
                    "price": str(old_offer.price), "status": "superseded"},
            "new": {"booking_id": str(new_booking.id), "vendor_name": new_vendor.name,
                    "price": str(new_offer.price), "status": "confirmed"},
            "delta": str(delta),
            "schedule_collisions": collisions,
        }
        await _append(session, event, 6, diff)

        # 7 - approval gate, same function the happy path uses, recovery baseline
        decision = evaluate_approval(
            total_cost=new_total,
            budget_cap=production.budget_cap,
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
            event.status = "awaiting_approval"
            production.status = "awaiting_approval"
            outcome = "awaiting_approval"
        else:
            event.status = "resolved"
            production.status = "booked"
            outcome = "resolved"

        await _append(session, event, 7, gate)
        event.resolution_booking_id = new_booking.id
        timeline = event.timeline

    log.info("recovery_complete", extra={"production_id": production_id, "outcome": outcome})
    return {"recovery_event_id": str(event_id), "timeline": timeline, "outcome": outcome}


@mcp.tool
async def recover(production_id: str, booking_id: str, trigger: str = "vendor_unavailable") -> dict:
    """Run the 7-step recovery for a booking whose vendor has dropped out."""
    return await _recover(production_id, booking_id, trigger)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Recovery Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
