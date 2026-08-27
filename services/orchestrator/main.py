import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.auth import Producer, issue_demo_token, require_producer
from cinex.config import get_settings
from cinex.db.models import Approval, AuditLog, Booking, Production, RecoveryEvent
from cinex.db.session import init_db, session_scope
from cinex.logging import get_logger
from cinex.mcp_client import get_agents
from cinex.steps import read_steps
from services.orchestrator.pipeline import resume_after_approval, run_happy_path

log = get_logger("orchestrator-api")
SSE_POLL_SECONDS = 0.5
SSE_MAX_SECONDS = 300
TERMINAL = {"booked", "failed", "awaiting_approval"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # FastAPI's @app.on_event("startup") is deprecated in favour of this lifespan
    # context manager (see task-17 brief); init_db() must still run once at startup.
    await init_db()
    yield


app = FastAPI(title="CineXchange Orchestrator", lifespan=lifespan)


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

        await write_audit(session, actor="producer", action=f"approval_{body.decision}",
                          entity_type="approval", entity_id=approval_id,
                          payload={"production_id": str(production_id)})

        if body.decision == "rejected":
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            production.status = "failed"

    if body.decision == "approved":
        background.add_task(resume_after_approval, production_id)

    return {"approval_id": str(approval_id), "decision": body.decision,
            "production_id": str(production_id)}


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
