"""Guard-path coverage for POST /productions/{id}/recovery that needs no LLM.

The happy-path recovery flow (tests/test_integration_recovery.py) is gated on a
live GEMINI_API_KEY because it drives the full pipeline before ever reaching
this endpoint. But the endpoint's own guards - the 409 when there is nothing
to recover, the most-expensive-booking auto-select, and the idempotency
short-circuit - are pure DB/auth logic with the recovery agent call mocked
out, so they are testable without any LLM and are exactly what protects a
live demo from a fumble.
"""
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from cinex.auth import issue_demo_token
from cinex.db.models import Booking, Offer, RecoveryEvent, Requirement, Vendor

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


async def _make_confirmed_booking(session, production, price: Decimal) -> Booking:
    requirement = Requirement(production_id=production.id, category="camera",
                              spec={}, quantity=1, priority=1)
    session.add(requirement)
    await session.flush()

    vendor = Vendor(name=f"Vendor {uuid.uuid4()}", category="camera",
                    rating=Decimal("4.5"), base_price=price,
                    availability_calendar={"blocked": []}, contact_meta={})
    session.add(vendor)
    await session.flush()

    offer = Offer(requirement_id=requirement.id, vendor_id=vendor.id, price=price,
                  terms={}, status="accepted", round=1, is_winner=True)
    session.add(offer)
    await session.flush()

    booking = Booking(production_id=production.id, offer_id=offer.id,
                      final_price=price, status="confirmed")
    session.add(booking)
    await session.flush()
    return booking


async def test_recovery_with_no_confirmed_booking_returns_409(client, auth, session, production):
    r = await client.post(f"/productions/{production.id}/recovery",
                          headers=auth, json={})
    assert r.status_code == 409
    assert r.json()["detail"] == "no confirmed booking to recover"


async def test_recovery_auto_selects_the_most_expensive_confirmed_booking(
    client, auth, session, production, monkeypatch,
):
    cheap = await _make_confirmed_booking(session, production, Decimal("1000.00"))
    pricey = await _make_confirmed_booking(session, production, Decimal("5000.00"))
    await session.commit()

    from services.orchestrator import main
    agents = AsyncMock()
    agents.call = AsyncMock(return_value={
        "recovery_event_id": str(uuid.uuid4()), "timeline": [], "outcome": "resolved",
    })
    monkeypatch.setattr(main, "get_agents", lambda: agents)

    r = await client.post(f"/productions/{production.id}/recovery",
                          headers=auth, json={"trigger": "vendor_unavailable"})
    assert r.status_code == 200, r.text

    agents.call.assert_awaited_once()
    call_agent, call_tool, call_args = agents.call.await_args.args
    assert call_agent == "recovery"
    assert call_tool == "recover"
    assert call_args["booking_id"] == str(pricey.id), \
        "must pick the pricier confirmed booking, not just any confirmed booking"
    assert call_args["booking_id"] != str(cheap.id)


async def test_active_recovery_event_short_circuits_without_calling_the_agent(
    client, auth, session, production, monkeypatch,
):
    booking = await _make_confirmed_booking(session, production, Decimal("2000.00"))
    existing = RecoveryEvent(
        production_id=production.id, trigger="vendor_unavailable",
        affected_booking_id=booking.id, status="in_progress",
        timeline=[{"step": 1, "name": "find_replacement", "ts": "x", "detail": {}}],
    )
    session.add(existing)
    await session.commit()
    await session.refresh(existing)

    from services.orchestrator import main
    agents = AsyncMock()
    agents.call = AsyncMock()
    monkeypatch.setattr(main, "get_agents", lambda: agents)

    r = await client.post(f"/productions/{production.id}/recovery",
                          headers=auth, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "already_in_progress"
    assert body["recovery_event_id"] == str(existing.id)
    agents.call.assert_not_awaited()


async def test_recovery_requires_auth(client, production):
    r = await client.post(f"/productions/{production.id}/recovery", json={})
    assert r.status_code == 403
