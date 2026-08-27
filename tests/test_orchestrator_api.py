import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from cinex.auth import issue_demo_token
from cinex.config import get_settings
from cinex.db.models import Approval, Booking, Offer, Production, Requirement, Vendor

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


# ---------------------------------------------------------------------------
# The aggregate read model. The response *shape* is asserted without a database
# in tests/test_orchestrator_read_model.py; what needs Postgres - and only
# Postgres - is the SQL underneath: the producer filter, the newest-first order,
# and the multi-entity audit_log fan-in that stitches offers, requirements,
# approvals and recovery events back together.
# ---------------------------------------------------------------------------

async def _demo_production(session, brief: str, budget: Decimal) -> Production:
    """A production owned by the demo token's producer, so GET /productions sees it."""
    row = Production(
        producer_id=uuid.UUID(get_settings().demo_producer_id),
        brief_text=brief, budget_cap=budget, location="Lisbon",
        start_date=date(2026, 9, 1), end_date=date(2026, 9, 3), status="draft",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def test_list_productions_is_scoped_to_the_authenticated_producer(client, auth, session,
                                                                        production):
    """`production` (the shared fixture) belongs to a random producer_id and must
    not appear in the demo producer's list."""
    mine = await _demo_production(session, "Demo producer run", Decimal("50000.00"))

    body = (await client.get("/productions", headers=auth)).json()

    ids = [p["production_id"] for p in body["productions"]]
    assert str(mine.id) in ids
    assert str(production.id) not in ids, "another producer's run must not leak"
    assert body["count"] == len(body["productions"])


async def test_list_productions_is_newest_first_and_truncates_the_brief(client, auth, session):
    await _demo_production(session, "older run", Decimal("10000.00"))
    newer = await _demo_production(session, "x" * 500, Decimal("20000.00"))

    body = (await client.get("/productions", headers=auth)).json()

    assert body["productions"][0]["production_id"] == str(newer.id)
    assert body["productions"][0]["brief_truncated"] is True
    assert body["productions"][0]["brief_text"].endswith("...")
    assert body["productions"][0]["budget_cap"] == "20000.00"


async def test_list_productions_requires_auth(client):
    assert (await client.get("/productions")).status_code == 403


async def test_production_detail_404s_for_an_unknown_id(client, auth):
    r = await client.get(f"/productions/{uuid.uuid4()}", headers=auth)
    assert r.status_code == 404


async def test_production_detail_stitches_rows_and_audit_payloads_together(client, auth,
                                                                          session, production):
    """The whole point of the endpoint: rank lives only in scout's audit payload,
    the negotiation rounds only in the negotiation agent's, and both have to come
    back attached to the right requirement and offer."""
    from cinex.audit import write_audit

    requirement = Requirement(production_id=production.id, category="camera",
                              spec={"role": "drone operator"}, quantity=1, priority=1)
    session.add(requirement)
    await session.flush()

    vendor = Vendor(name="Atlantic Aerials", category="camera", rating=Decimal("4.70"),
                    base_price=Decimal("45000.00"), availability_calendar={"blocked": []},
                    contact_meta={"endpoint": "http://vendor-mock-1:9001"})
    session.add(vendor)
    await session.flush()

    offer = Offer(requirement_id=requirement.id, vendor_id=vendor.id,
                  price=Decimal("41000.00"), terms={}, status="accepted",
                  round=2, is_winner=True)
    session.add(offer)
    await session.flush()

    booking = Booking(production_id=production.id, offer_id=offer.id,
                      final_price=Decimal("41000.00"), status="confirmed")
    session.add(booking)

    await write_audit(session, actor="scout-agent", action="find_vendors",
                      entity_type="requirement", entity_id=requirement.id,
                      payload={"category": "camera", "considered": 1, "excluded": [],
                               "offers": [{"offer_id": str(offer.id),
                                           "vendor_id": str(vendor.id),
                                           "vendor_name": "Atlantic Aerials",
                                           "price": "45000.00", "terms": {},
                                           "rank": 1, "available": True}]})
    await write_audit(session, actor="negotiation-agent", action="negotiation_round",
                      entity_type="offer", entity_id=offer.id,
                      payload={"round": 1, "vendor_id": str(vendor.id),
                               "vendor_name": "Atlantic Aerials", "offered": "41000.00",
                               "conceded_terms": [], "rationale": "close the gap",
                               "decision": "accept", "vendor_price": "41000.00",
                               "vendor_message": "done"})
    await session.commit()

    body = (await client.get(f"/productions/{production.id}", headers=auth)).json()

    assert body["production"]["production_id"] == str(production.id)
    assert body["production"]["budget_cap"] == "120000.00"

    [req] = body["requirements"]
    assert req["requirement_id"] == str(requirement.id)
    assert req["category"] == "camera"

    [off] = req["offers"]
    assert off["rank"] == 1, "from scout's audit payload - there is no rank column"
    assert off["available"] is True
    assert off["quoted_price"] == "45000.00"
    assert off["price"] == "41000.00", "the negotiated price, from the offers row"
    assert off["vendor_name"] == "Atlantic Aerials"
    assert off["score_breakdown"] is None

    rounds = req["negotiation"]["rounds"]
    assert [r["round"] for r in rounds] == [1]
    assert rounds[0]["decision"] == "accept"
    assert rounds[0]["offer_id"] == str(offer.id), "regrouped from offer onto requirement"

    [bkg] = body["bookings"]
    assert bkg["final_price"] == "41000.00"
    assert bkg["vendor_name"] == "Atlantic Aerials"
    assert bkg["requirement_id"] == str(requirement.id)

    assert "risk_assessment" in body["unavailable"]


async def test_production_detail_requires_auth(client, production):
    assert (await client.get(f"/productions/{production.id}")).status_code == 403
