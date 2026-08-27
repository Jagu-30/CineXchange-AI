import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from cinex.db.models import AuditLog
from cinex.logging import get_logger

log = get_logger("cinex.audit")


def jsonable(value: Any) -> Any:
    """Decimals become exact strings. A float would silently lose cents."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


async def write_audit(
    session: AsyncSession,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    payload: dict | None = None,
) -> AuditLog:
    row = AuditLog(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=jsonable(payload or {}),
        # Postgres' now()/CURRENT_TIMESTAMP (the column's server_default) is frozen at
        # transaction start, so two audit rows written in the same transaction would get
        # an identical created_at and read_steps' ORDER BY created_at, id would then tie-break
        # on a random UUID instead of insertion order. Stamp wall-clock time explicitly so
        # append order within a transaction is preserved.
        created_at=datetime.now(timezone.utc),
    )
    session.add(row)
    await session.flush()
    log.info("audit", extra={"actor": actor, "action": action, "entity_id": str(entity_id)})
    return row
