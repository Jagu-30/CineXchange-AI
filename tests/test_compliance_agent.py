import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from cinex.db.models import Approval, ComplianceCheck, Offer, Requirement, Vendor

pytestmark = pytest.mark.integration


@pytest.fixture
async def priced_production(session, production):
    r = Requirement(production_id=production.id, category="crew",
                    spec={"role": "drone operator", "requires_certification": True},
                    quantity=1, priority=1)
    loc = Requirement(production_id=production.id, category="location",
                      spec={"site": "Praca do Comercio"}, quantity=1, priority=1)
    session.add_all([r, loc])
    await session.flush()
    v = Vendor(id=uuid.uuid4(), name="Aerial", category="crew", rating=Decimal("4.5"),
               base_price=Decimal("3000.00"), availability_calendar={"blocked": []},
               contact_meta={"endpoint": "http://v1"})
    session.add(v)
    await session.flush()
    session.add(Offer(requirement_id=r.id, vendor_id=v.id, price=Decimal("3000.00"),
                      terms={}, status="accepted", round=1, is_winner=True))
    await session.commit()
    return production


async def test_check_compliance_writes_three_checks(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    assert {c["check_type"] for c in out["checks"]} == {"permit", "insurance", "licensing"}

    rows = (await session.execute(
        select(ComplianceCheck).where(ComplianceCheck.production_id == priced_production.id)
    )).scalars().all()
    assert len(rows) == 3


async def test_uncredentialled_drone_operator_fails_overall(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    licensing = next(c for c in out["checks"] if c["check_type"] == "licensing")
    assert licensing["status"] == "fail"
    assert out["overall"] == "fail"


async def test_evidence_is_labelled_as_mock(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    assert all("MOCK DATA" in c["evidence"]["disclaimer"] for c in out["checks"])


async def test_request_approval_creates_a_pending_row(session, priced_production):
    from services.compliance_agent.main import _request_approval

    out = await _request_approval(
        str(priced_production.id), reason="threshold_breached",
        delta_amount="15000.00", threshold_breached=True,
    )
    approval = (await session.execute(
        select(Approval).where(Approval.id == uuid.UUID(out["approval_id"]))
    )).scalar_one()
    assert approval.producer_decision == "pending"
    assert approval.requested_by_agent == "compliance-agent"
    assert approval.delta_amount == Decimal("15000.00")
