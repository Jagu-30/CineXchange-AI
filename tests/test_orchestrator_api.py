import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from cinex.auth import issue_demo_token
from cinex.db.models import Approval, Production

pytestmark = pytest.mark.integration


@pytest.fixture
async def client(monkeypatch):
    from services.orchestrator import main
    monkeypatch.setattr(main, "run_happy_path", AsyncMock())
    monkeypatch.setattr(main, "resume_after_approval", AsyncMock())
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as c:
        yield c


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {issue_demo_token()}"}


async def test_token_endpoint_issues_a_usable_token(client):
    r = await client.post("/auth/token")
    assert r.status_code == 200
    assert r.json()["access_token"]


async def test_create_production_returns_202_immediately(client, auth):
    r = await client.post("/productions", headers=auth, json={
        "brief_text": "Two-day shoot in Lisbon with aerial coverage",
        "budget_cap": "120000.00", "location": "Lisbon",
        "start_date": "2026-09-01", "end_date": "2026-09-02",
    })
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "draft"
    uuid.UUID(body["production_id"])


async def test_create_production_requires_auth(client):
    r = await client.post("/productions", json={
        "brief_text": "x", "budget_cap": "1.00", "location": "Lisbon",
        "start_date": "2026-09-01", "end_date": "2026-09-02",
    })
    assert r.status_code == 403


async def test_status_reports_steps(client, auth, session, production):
    from cinex.steps import emit_step
    await emit_step(session, production.id, 2, "decompose", "done", {"requirements": 4})
    await session.commit()

    r = await client.get(f"/productions/{production.id}/status", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "draft"
    assert body["steps"][-1]["name"] == "decompose"


async def test_trace_returns_the_full_ordered_audit_log(client, auth, session, production):
    from cinex.audit import write_audit
    await write_audit(session, actor="scout-agent", action="find_vendors",
                      entity_type="production", entity_id=production.id, payload={"n": 3})
    await session.commit()

    r = await client.get(f"/productions/{production.id}/trace", headers=auth)
    assert r.status_code == 200
    actors = {entry["actor"] for entry in r.json()["trace"]}
    assert "scout-agent" in actors


async def test_decide_approval_approves_and_resumes(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="threshold_breached", threshold_breached=True,
                        delta_amount=Decimal("100.00"))
    session.add(approval)
    await session.commit()

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "approved"})
    assert r.status_code == 200
    await session.refresh(approval)
    assert approval.producer_decision == "approved"
    assert approval.decided_at is not None


async def test_rejecting_an_approval_fails_the_production(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="over_budget_cap", threshold_breached=False,
                        delta_amount=Decimal("100.00"))
    session.add(approval)
    await session.commit()

    await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                      json={"decision": "rejected"})
    await session.refresh(production)
    assert production.status == "failed"


async def test_deciding_twice_is_rejected(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="x", threshold_breached=False, delta_amount=Decimal("0"),
                        producer_decision="approved")
    session.add(approval)
    await session.commit()

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "rejected"})
    assert r.status_code == 409
