import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinex.audit import write_audit
from cinex.db.models import AuditLog

STEP_ACTION_PREFIX = "step."
ORCHESTRATOR = "orchestrator"


@dataclass(frozen=True)
class StepEvent:
    production_id: uuid.UUID
    step: int
    name: str
    status: str          # in_progress | done | failed
    detail: dict
    ts: datetime
    seq: int

    def sse(self) -> str:
        import json
        body = {
            "production_id": str(self.production_id),
            "step": self.step,
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "ts": self.ts.isoformat(),
            "seq": self.seq,
        }
        return f"event: step\ndata: {json.dumps(body)}\n\n"


async def emit_step(
    session: AsyncSession,
    production_id: uuid.UUID,
    step: int,
    name: str,
    status: str,
    detail: dict | None = None,
) -> AuditLog:
    return await write_audit(
        session,
        actor=ORCHESTRATOR,
        action=f"{STEP_ACTION_PREFIX}{name}.{status}",
        entity_type="production",
        entity_id=production_id,
        payload={"step": step, "name": name, "status": status, "detail": detail or {}},
    )


async def read_steps(
    session: AsyncSession, production_id: uuid.UUID, after_seq: int | None = None
) -> list[StepEvent]:
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == "production",
            AuditLog.entity_id == production_id,
            AuditLog.action.startswith(STEP_ACTION_PREFIX),
        )
        .order_by(AuditLog.seq)
    )
    if after_seq is not None:
        stmt = stmt.where(AuditLog.seq > after_seq)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        StepEvent(
            production_id=production_id,
            step=r.payload["step"],
            name=r.payload["name"],
            status=r.payload["status"],
            detail=r.payload.get("detail", {}),
            ts=r.created_at,
            seq=r.seq,
        )
        for r in rows
    ]
