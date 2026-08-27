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


# --- C1: a producer decision on a RECOVERY approval must not take the happy path ---


@pytest.fixture
def recovery_routing(monkeypatch):
    """Route the orchestrator's resolve_recovery MCP hop into the real agent code.

    The point of these tests is the routing decision plus the state it leaves
    behind, so the tool body has to be the real one - a canned dict would prove
    nothing about the recovery_events row.
    """
    from services.orchestrator import main
    from services.recovery_agent.main import _resolve_recovery

    calls = []

    async def fake_call(agent, tool, args):
        calls.append((agent, tool, args))
        if tool == "resolve_recovery":
            return await _resolve_recovery(args["production_id"], args["decision"])
        raise AssertionError(f"unexpected tool {tool}")

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=fake_call)
    monkeypatch.setattr(main, "get_agents", lambda: agents)
    return calls


async def _awaiting_recovery(session, production, price=Decimal("2300.00")):
    """A production parked exactly where recovery step 7 leaves it."""
    from cinex.db.models import Approval

    replacement = await _make_confirmed_booking(session, production, price)
    event = RecoveryEvent(
        production_id=production.id, trigger="vendor_unavailable",
        affected_booking_id=replacement.id, resolution_booking_id=replacement.id,
        status="awaiting_approval",
        timeline=[{"step": n, "name": "s", "ts": "x", "detail": {}} for n in range(1, 8)],
    )
    approval = Approval(
        production_id=production.id, requested_by_agent="recovery-agent",
        reason="recovery:threshold_breached", threshold_breached=True,
        delta_amount=Decimal("400.00"),
    )
    production.status = "awaiting_approval"
    session.add_all([event, approval])
    await session.commit()
    await session.refresh(event)
    await session.refresh(approval)
    return event, approval, replacement


async def test_approving_a_recovery_resolves_the_event_and_skips_the_happy_path(
    client, auth, session, production, recovery_routing,
):
    from services.orchestrator import main

    event, approval, _ = await _awaiting_recovery(session, production)

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "approved"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "recovery"

    await session.refresh(event)
    await session.refresh(production)
    assert event.status == "resolved", "an approved recovery must leave awaiting_approval"
    assert production.status == "booked"
    main.resume_after_approval.assert_not_awaited()
    assert [tool for _, tool, _ in recovery_routing] == ["resolve_recovery"]


async def test_rejecting_a_recovery_fails_the_event_and_leaves_the_swap_in_place(
    client, auth, session, production, recovery_routing,
):
    from cinex.db.models import AuditLog

    event, approval, replacement = await _awaiting_recovery(session, production)

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "rejected"})
    assert r.status_code == 200, r.text

    await session.refresh(event)
    await session.refresh(production)
    await session.refresh(replacement)
    assert event.status == "failed"
    assert production.status == "failed"
    assert replacement.status == "confirmed", \
        "the vendor was already told; nothing may be silently un-booked"

    audits = (await session.execute(select(AuditLog))).scalars().all()
    rejected = [a for a in audits if a.action == "recovery_rejected"]
    assert len(rejected) == 1, "the rejected-after-swap state must be explicit in the trace"
    assert rejected[0].payload["production_status"] == "failed"


async def test_a_second_recovery_can_be_triggered_once_the_first_resolves(
    client, auth, session, production, recovery_routing,
):
    event, approval, replacement = await _awaiting_recovery(session, production)

    blocked = await client.post(f"/productions/{production.id}/recovery",
                                headers=auth, json={})
    assert blocked.json()["outcome"] == "already_in_progress"

    await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                      json={"decision": "approved"})

    recovery_routing.clear()

    async def resolved_recovery(agent, tool, args):
        return {"recovery_event_id": str(uuid.uuid4()), "timeline": [], "outcome": "resolved"}

    from services.orchestrator import main
    main.get_agents().call.side_effect = resolved_recovery

    again = await client.post(f"/productions/{production.id}/recovery",
                              headers=auth, json={})
    assert again.status_code == 200, again.text
    assert again.json()["outcome"] != "already_in_progress", \
        "a resolved recovery must not lock the production out of the next one"
