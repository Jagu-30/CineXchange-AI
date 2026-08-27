import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Approval, ComplianceCheck, Offer, Production, Requirement
from cinex.db.session import session_scope
from cinex.logging import get_logger
from services.compliance_agent.rules import (
    check_insurance, check_licensing, check_permit, evaluate_approval,
)

log = get_logger("compliance-agent")
mcp = FastMCP("compliance-agent")
AGENT = "compliance-agent"
EQUIPMENT_CATEGORIES = {"camera", "transport"}


async def _check_compliance(production_id: str) -> dict:
    pid = uuid.UUID(production_id)
    settings = get_settings()

    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        requirements = (await session.execute(
            select(Requirement).where(Requirement.production_id == pid)
        )).scalars().all()

        categories = {r.category for r in requirements}
        crew_specs = [r.spec for r in requirements if r.category == "crew"]

        equipment_ids = [r.id for r in requirements if r.category in EQUIPMENT_CATEGORIES]
        equipment_value = Decimal("0")
        if equipment_ids:
            winning = (await session.execute(
                select(Offer).where(Offer.requirement_id.in_(equipment_ids), Offer.is_winner.is_(True))
            )).scalars().all()
            equipment_value = sum((o.price for o in winning), Decimal("0"))

        results = [
            check_permit(production.location, production.start_date, production.end_date, categories),
            check_insurance(equipment_value, settings.insurance_rider_threshold),
            check_licensing(crew_specs),
        ]

        checks = []
        for result in results:
            session.add(ComplianceCheck(
                production_id=pid, check_type=result.check_type,
                status=result.status, evidence=result.evidence,
            ))
            checks.append({
                "check_type": result.check_type, "status": result.status,
                "evidence": result.evidence,
            })

        overall = "fail" if any(c["status"] == "fail" for c in checks) else "pass"
        await write_audit(
            session, actor=AGENT, action="check_compliance",
            entity_type="production", entity_id=pid,
            payload={"checks": checks, "overall": overall,
                     "equipment_value": equipment_value},
        )

    return {"checks": checks, "overall": overall}


async def _request_approval(
    production_id: str, reason: str, delta_amount: str, threshold_breached: bool
) -> dict:
    pid = uuid.UUID(production_id)
    async with session_scope() as session:
        approval = Approval(
            production_id=pid, requested_by_agent=AGENT, reason=reason,
            threshold_breached=threshold_breached, delta_amount=Decimal(delta_amount),
            producer_decision="pending",
        )
        session.add(approval)
        await session.flush()
        await write_audit(
            session, actor=AGENT, action="request_approval",
            entity_type="approval", entity_id=approval.id,
            payload={"production_id": str(pid), "reason": reason,
                     "delta_amount": delta_amount, "threshold_breached": threshold_breached},
        )
        approval_id = str(approval.id)

    log.info("approval_requested", extra={"production_id": production_id, "reason": reason})
    return {"approval_id": approval_id, "status": "pending"}


@mcp.tool
async def check_compliance(production_id: str) -> dict:
    """Run permit, insurance, and licensing checks against mock registries."""
    return await _check_compliance(production_id)


@mcp.tool
async def request_approval(
    production_id: str, reason: str, delta_amount: str, threshold_breached: bool = False
) -> dict:
    """Open a producer approval gate."""
    return await _request_approval(production_id, reason, delta_amount, threshold_breached)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Compliance Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
