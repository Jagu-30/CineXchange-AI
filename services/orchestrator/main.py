import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select

from cinex.audit import write_audit
from cinex.auth import Producer, issue_demo_token, require_producer
from cinex.clickhouse import init_clickhouse
from cinex.config import get_settings
from cinex.db.models import (
    Approval, AuditLog, Booking, ComplianceCheck, Offer, Production, RecoveryEvent, Requirement,
    Vendor,
)
from cinex.db.session import init_db, session_scope
from cinex.logging import get_logger
from cinex.mcp_client import get_agents
from cinex.steps import read_steps
from services.orchestrator.aggregate import ProductionRecords, build_detail, build_summary
from services.orchestrator.pipeline import resume_after_approval, run_happy_path

log = get_logger("orchestrator-api")
SSE_POLL_SECONDS = 0.5
SSE_MAX_SECONDS = 300
TERMINAL = {"booked", "failed", "awaiting_approval"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # FastAPI's @app.on_event("startup") is deprecated in favour of this lifespan
    # context manager (see task-17 brief); init_db() must still run once at startup.
    # Task 21's brief shows this as an @app.on_event("startup") hook - folded into
    # the existing lifespan handler instead, since Task 17 already replaced that
    # pattern here.
    await init_db()
    try:
        await init_clickhouse()
    except Exception as exc:  # noqa: BLE001 - analytics is optional to boot
        log.warning("clickhouse_init_failed", extra={"error": str(exc)})
    yield


app = FastAPI(title="CineXchange Orchestrator", lifespan=lifespan)

# The browser app and this API are separate origins in every deployment we have
# (Next.js on :3000, uvicorn on :8000), so without this the frontend cannot read
# a single response. Origins come from FRONTEND_ORIGIN and are always explicit;
# Settings.allowed_origins() documents why "*" is never an option here.
#
# allow_credentials=True is what makes the SSE stream at GET
# /productions/{id}/events usable from `new EventSource(url, {withCredentials:
# true})`. The CORS spec then requires a concrete origin in
# Access-Control-Allow-Origin, which an explicit list satisfies and "*" would
# not - the browser would reject every response.
#
# Authorization is listed explicitly because it is NOT a CORS-safelisted request
# header: omit it and the preflight for every bearer-authed endpoint
# (/productions, /productions/{id}, /status, /trace, /approvals/.../decide,
# /recovery) fails before the real request is ever sent. Content-Type covers the
# JSON POST bodies. OPTIONS is in allow_methods for the preflight itself.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


class ProductionRequest(BaseModel):
    brief_text: str = Field(min_length=10)
    budget_cap: Decimal
    location: str
    start_date: date
    end_date: date


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")


class RecoveryRequest(BaseModel):
    booking_id: uuid.UUID | None = None
    trigger: str = "vendor_unavailable"


@app.get("/healthz")
async def healthz() -> dict:
    agents = get_agents()
    reachable = {}
    for name in get_settings().agent_urls():
        try:
            reachable[name] = await agents.list_tools(name)
        except Exception as exc:  # noqa: BLE001 - health must report, not raise
            reachable[name] = f"unreachable: {exc}"
    return {"ok": True, "agents": reachable}


@app.post("/auth/token")
async def token() -> dict:
    return {"access_token": issue_demo_token(), "token_type": "bearer"}


@app.post("/productions", status_code=202)
async def create_production(
    body: ProductionRequest,
    background: BackgroundTasks,
    producer: Producer = Depends(require_producer),
) -> dict:
    async with session_scope() as session:
        production = Production(
            producer_id=producer.id, brief_text=body.brief_text, budget_cap=body.budget_cap,
            location=body.location, start_date=body.start_date, end_date=body.end_date,
            status="draft",
        )
        session.add(production)
        await session.flush()
        production_id = production.id
        await write_audit(session, actor="producer", action="submit_brief",
                          entity_type="production", entity_id=production_id,
                          payload={"budget_cap": body.budget_cap, "location": body.location})

    background.add_task(run_happy_path, production_id)
    return {"production_id": str(production_id), "status": "draft"}


@app.get("/productions")
async def list_productions(
    producer: Producer = Depends(require_producer),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    """Every production this producer has started, newest first.

    Without this the frontend cannot find a run again after a page reload: the
    production_id only ever existed in the 202 body of POST /productions.

    Scoped to the authenticated producer - unlike the per-production endpoints,
    this one enumerates, so it must not leak another producer's runs.
    """
    async with session_scope() as session:
        rows = (await session.execute(
            select(Production)
            .where(Production.producer_id == producer.id)
            # created_at is a server default, so two productions created inside one
            # transaction share it; id breaks the tie deterministically rather than
            # letting the page order wobble between requests.
            .order_by(Production.created_at.desc(), Production.id.desc())
            .limit(limit)
        )).scalars().all()

    return {"productions": [build_summary(p) for p in rows], "count": len(rows)}


@app.get("/productions/{production_id}")
async def production_detail(
    production_id: uuid.UUID, _: Producer = Depends(require_producer)
) -> dict:
    """Everything the producer console needs about one run, in one round trip.

    Assembled strictly from rows that exist and audit payloads that were actually
    written. Anything the UI asked for that no agent ever recorded is named -
    with the reason - under the `unavailable` key, never guessed at.

    Ownership is deliberately not filtered here, matching the sibling /status and
    /trace endpoints: a production_id is already an unguessable UUID, and the
    seeded demo runs carry a different producer_id than the demo token's.
    """
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one_or_none()
        if production is None:
            raise HTTPException(status_code=404, detail="unknown production")

        requirements = (await session.execute(
            select(Requirement)
            .where(Requirement.production_id == production_id)
            .order_by(Requirement.priority, Requirement.created_at)
        )).scalars().all()
        requirement_ids = [r.id for r in requirements]

        offers = (await session.execute(
            select(Offer)
            .where(Offer.requirement_id.in_(requirement_ids))
            .order_by(Offer.created_at)
        )).scalars().all()

        vendor_ids = {o.vendor_id for o in offers}
        vendors = {
            v.id: v
            for v in (await session.execute(
                select(Vendor).where(Vendor.id.in_(vendor_ids))
            )).scalars().all()
        }

        bookings = (await session.execute(
            select(Booking)
            .where(Booking.production_id == production_id)
            .order_by(Booking.created_at)
        )).scalars().all()

        checks = (await session.execute(
            select(ComplianceCheck)
            .where(ComplianceCheck.production_id == production_id)
            .order_by(ComplianceCheck.created_at)
        )).scalars().all()

        approvals = (await session.execute(
            select(Approval)
            .where(Approval.production_id == production_id)
            .order_by(Approval.created_at)
        )).scalars().all()

        recovery_events = (await session.execute(
            select(RecoveryEvent)
            .where(RecoveryEvent.production_id == production_id)
            .order_by(RecoveryEvent.created_at)
        )).scalars().all()

        steps = await read_steps(session, production_id)

        # One pass over the audit log covering every entity this production owns.
        # The round-by-round negotiation history, scout's rank/availability and an
        # approval's delta_pct exist ONLY in these payloads - there is no column
        # for any of them - so the aggregate is not assemblable without this read.
        audit = (await session.execute(
            select(AuditLog)
            .where(or_(
                and_(AuditLog.entity_type == "production",
                     AuditLog.entity_id == production_id),
                and_(AuditLog.entity_type == "requirement",
                     AuditLog.entity_id.in_(requirement_ids)),
                and_(AuditLog.entity_type == "offer",
                     AuditLog.entity_id.in_([o.id for o in offers])),
                and_(AuditLog.entity_type == "approval",
                     AuditLog.entity_id.in_([a.id for a in approvals])),
                and_(AuditLog.entity_type == "recovery_event",
                     AuditLog.entity_id.in_([e.id for e in recovery_events])),
            ))
            .order_by(AuditLog.seq)
        )).scalars().all()

    return build_detail(ProductionRecords(
        production=production,
        requirements=list(requirements),
        offers=list(offers),
        vendors=vendors,
        bookings=list(bookings),
        checks=list(checks),
        approvals=list(approvals),
        recovery_events=list(recovery_events),
        steps=steps,
        audit=list(audit),
    ))


@app.get("/productions/{production_id}/status")
async def status(production_id: uuid.UUID, _: Producer = Depends(require_producer)) -> dict:
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one_or_none()
        if production is None:
            raise HTTPException(status_code=404, detail="unknown production")
        steps = await read_steps(session, production_id)
        pending = (await session.execute(
            select(Approval).where(Approval.production_id == production_id,
                                   Approval.producer_decision == "pending")
        )).scalars().first()

    return {
        "production_id": str(production_id),
        "status": production.status,
        "current_step": production.current_step,
        "total_cost": str(production.total_cost) if production.total_cost is not None else None,
        "budget_cap": str(production.budget_cap),
        "pending_approval_id": str(pending.id) if pending else None,
        "steps": [
            {"step": s.step, "name": s.name, "status": s.status,
             "detail": s.detail, "ts": s.ts.isoformat()}
            for s in steps
        ],
    }


@app.get("/productions/{production_id}/events")
async def events(production_id: uuid.UUID) -> StreamingResponse:
    """SSE over the same DB projection /status reads, so the two cannot disagree."""
    async def stream():
        cursor: int | None = None
        waited = 0.0
        while waited < SSE_MAX_SECONDS:
            async with session_scope() as session:
                fresh = await read_steps(session, production_id, after_seq=cursor)
                production = (await session.execute(
                    select(Production.status).where(Production.id == production_id)
                )).scalar_one_or_none()
            for event in fresh:
                cursor = event.seq
                yield event.sse()
            if production in TERMINAL:
                # Belt and braces on top of the pipeline's commit ordering:
                # drain whatever step rows exist before closing, so the stream
                # can never end having skipped a step /status would show.
                async with session_scope() as session:
                    tail = await read_steps(session, production_id, after_seq=cursor)
                for event in tail:
                    cursor = event.seq
                    yield event.sse()
                yield f"event: end\ndata: {{\"status\": \"{production}\"}}\n\n"
                return
            await asyncio.sleep(SSE_POLL_SECONDS)
            waited += SSE_POLL_SECONDS

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/productions/{production_id}/trace")
async def trace(production_id: uuid.UUID, _: Producer = Depends(require_producer)) -> dict:
    """Every agent decision for this production, in order. The answer to
    'prove this isn't scripted'."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(AuditLog).where(
                (AuditLog.entity_id == production_id)
                | (AuditLog.payload["production_id"].astext == str(production_id))
            ).order_by(AuditLog.seq)
        )).scalars().all()

    return {
        "production_id": str(production_id),
        "entries": len(rows),
        "actors": sorted({r.actor for r in rows}),
        "trace": [
            {"ts": r.created_at.isoformat(), "actor": r.actor, "action": r.action,
             "entity_type": r.entity_type, "entity_id": str(r.entity_id) if r.entity_id else None,
             "payload": r.payload}
            for r in rows
        ],
    }


@app.post("/approvals/{approval_id}/decide")
async def decide(
    approval_id: uuid.UUID,
    body: ApprovalDecisionRequest,
    background: BackgroundTasks,
    _: Producer = Depends(require_producer),
) -> dict:
    async with session_scope() as session:
        approval = (await session.execute(
            select(Approval).where(Approval.id == approval_id)
        )).scalar_one_or_none()
        if approval is None:
            raise HTTPException(status_code=404, detail="unknown approval")
        if approval.producer_decision != "pending":
            raise HTTPException(status_code=409, detail="already decided")

        approval.producer_decision = body.decision
        approval.decided_at = datetime.now(timezone.utc)
        production_id = approval.production_id
        reason = approval.reason or ""

        # Which kind of approval is this? A recovery approval must NOT be routed
        # into the happy-path resume: that would re-run _book (duplicating the
        # step-10 rows) and leave the recovery_events row in `awaiting_approval`
        # forever - which, being inside the partial unique index predicate,
        # locks the production out of every future recovery. The authority is
        # the recovery_events row; the `recovery:` reason prefix corroborates it.
        recovery_event = (await session.execute(
            select(RecoveryEvent)
            .where(RecoveryEvent.production_id == production_id,
                   RecoveryEvent.status == "awaiting_approval")
            .order_by(RecoveryEvent.created_at.desc())
        )).scalars().first()

        # The recovery agent writes the `recovery:` Approval row BEFORE it moves
        # the event to `awaiting_approval`. A crash in that window leaves a
        # pending recovery approval with no event to find - and treating the
        # event row as the sole authority would then classify it `happy_path`
        # and re-run _book, double-booking the production. The reason prefix is
        # the second witness, so it decides rather than merely annotating.
        reason_says_recovery = reason.startswith("recovery:")
        is_recovery = recovery_event is not None or reason_says_recovery
        orphaned = reason_says_recovery and recovery_event is None

        await write_audit(
            session,
            actor="producer",
            action=f"approval_{body.decision}",
            entity_type="approval",
            entity_id=approval_id,
            payload={
                "production_id": str(production_id),
                "kind": ("recovery_orphaned" if orphaned
                         else "recovery" if is_recovery else "happy_path"),
                "recovery_event_id": (
                    str(recovery_event.id) if recovery_event is not None else None),
                "reason_prefix_corroborates": reason_says_recovery,
            },
        )

        if orphaned:
            # Nothing to settle and nothing safe to resume: the swap's own state
            # is unknown. Record it loudly and stop rather than book anything.
            await write_audit(
                session, actor="orchestrator", action="recovery_approval_orphaned",
                entity_type="approval", entity_id=approval_id,
                payload={"production_id": str(production_id), "reason": reason,
                         "detail": "recovery-reason approval with no awaiting_approval "
                                   "event; refusing to resume the happy path"},
            )

        if body.decision == "rejected" and not is_recovery:
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            production.status = "failed"

    if orphaned:
        pass  # audited above; settling and resuming are both unsafe here
    elif is_recovery:
        await _settle_recovery(production_id, body.decision)
    elif body.decision == "approved":
        background.add_task(resume_after_approval, production_id)

    return {"approval_id": str(approval_id), "decision": body.decision,
            "production_id": str(production_id),
            "kind": ("recovery_orphaned" if orphaned
                     else "recovery" if is_recovery else "happy_path")}


async def _settle_recovery(production_id: uuid.UUID, decision: str) -> None:
    """Close out a producer decision that belongs to a recovery.

    `recovery_events` belongs to recovery-agent, so the state change goes over
    MCP; `productions` is ours, so the terminal status is set here.

    On approval the replacement stands and the production is `booked` again. On
    rejection the swap has *already* happened - the old booking is superseded,
    the new one confirmed, and the replacement vendor has been told - so nothing
    is silently un-booked: the replacement stays, the event goes to `failed`,
    the production goes to `failed`, and an audit row says exactly that so a
    human can pick it up.
    """
    approved = decision == "approved"
    try:
        result = await get_agents().call("recovery", "resolve_recovery", {
            "production_id": str(production_id), "decision": decision,
        })
    except Exception as exc:  # noqa: BLE001 - nothing may fail silently
        async with session_scope() as session:
            await write_audit(session, actor="orchestrator",
                              action="recovery_resolution_failed",
                              entity_type="production", entity_id=production_id,
                              payload={"decision": decision, "error": str(exc)})
        log.error("recovery_resolution_failed",
                  extra={"production_id": str(production_id), "error": str(exc)})
        raise HTTPException(status_code=503,
                            detail="recovery agent could not resolve the recovery") from exc

    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one()
        production.status = "booked" if approved else "failed"
        await write_audit(
            session, actor="orchestrator",
            action="recovery_approved" if approved else "recovery_rejected",
            entity_type="production", entity_id=production_id,
            payload={
                "recovery_event_id": result.get("recovery_event_id"),
                "recovery_outcome": result.get("outcome"),
                "production_status": production.status,
                "note": (
                    "recovery approved; replacement booking stands"
                    if approved else
                    "recovery rejected AFTER the swap was committed. The replacement "
                    "booking is left confirmed and the superseded booking stays "
                    "superseded - the vendor was already told. The production is "
                    "marked failed for human follow-up."
                ),
            },
        )


@app.post("/productions/{production_id}/recovery")
async def recovery(
    production_id: uuid.UUID,
    body: RecoveryRequest,
    _: Producer = Depends(require_producer),
) -> dict:
    """Trigger the 7-step recovery. booking_id is optional - omitted, we take the
    most expensive confirmed booking, so the live demo needs one less UUID."""
    async with session_scope() as session:
        active = (await session.execute(
            select(RecoveryEvent).where(
                RecoveryEvent.production_id == production_id,
                RecoveryEvent.status.in_(("pending", "in_progress", "awaiting_approval")),
            )
        )).scalars().first()
        if active is not None:
            return {"recovery_event_id": str(active.id), "timeline": active.timeline,
                    "outcome": "already_in_progress"}

        booking_id = body.booking_id
        if booking_id is None:
            booking = (await session.execute(
                select(Booking)
                .where(Booking.production_id == production_id, Booking.status == "confirmed")
                .order_by(Booking.final_price.desc())
            )).scalars().first()
            if booking is None:
                raise HTTPException(status_code=409,
                                    detail="no confirmed booking to recover")
            booking_id = booking.id

        await write_audit(session, actor="producer", action="trigger_recovery",
                          entity_type="production", entity_id=production_id,
                          payload={"booking_id": str(booking_id), "trigger": body.trigger})

    return await get_agents().call("recovery", "recover", {
        "production_id": str(production_id),
        "booking_id": str(booking_id),
        "trigger": body.trigger,
    })
