# tests/test_recovery_agent.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import Booking, Offer, RecoveryEvent, Requirement, Vendor

pytestmark = pytest.mark.integration

STEP_NAMES = [
    "find_replacement", "negotiate_replacement", "recalculate_cost",
    "check_schedule", "update_records", "present_diff", "approval_gate",
]


@pytest.fixture
async def booked(session, production):
    r = Requirement(production_id=production.id, category="camera", spec={}, quantity=1, priority=1)
    session.add(r)
    await session.flush()

    failed = Vendor(id=uuid.UUID(int=300, version=4), name="Dropout Cams", category="camera",
                    rating=Decimal("4.5"), base_price=Decimal("2000.00"),
                    availability_calendar={"blocked": []}, contact_meta={"endpoint": "http://v1"})
    replacement = Vendor(id=uuid.UUID(int=301, version=4), name="Backup Cams", category="camera",
                         rating=Decimal("4.1"), base_price=Decimal("2200.00"),
                         availability_calendar={"blocked": ["2026-09-02"]},
                         contact_meta={"endpoint": "http://v2"})
    session.add_all([failed, replacement])
    await session.flush()

    offer = Offer(requirement_id=r.id, vendor_id=failed.id, price=Decimal("1900.00"),
                  terms={}, status="accepted", round=2, is_winner=True)
    session.add(offer)
    await session.flush()
    booking = Booking(production_id=production.id, offer_id=offer.id,
                      final_price=Decimal("1900.00"), status="confirmed")
    session.add(booking)
    production.total_cost = Decimal("1900.00")
    production.status = "booked"
    await session.commit()
    await session.refresh(booking)
    return production, booking, r, failed, replacement


@pytest.fixture
def replacement_agents(monkeypatch, booked):
    from services.recovery_agent import main
    _, _, requirement, failed, replacement = booked
    state = {}

    async def fake_call(agent, tool, args):
        if tool == "find_vendors":
            assert str(failed.id) in args["exclude_vendor_ids"], \
                "recovery must exclude the vendor that dropped out"
            async with main.session_scope() as s:
                o = Offer(requirement_id=uuid.UUID(args["requirement_id"]),
                          vendor_id=replacement.id, price=Decimal("2530.00"),
                          terms={}, status="pending", round=0)
                s.add(o)
                await s.flush()
                state["offer_id"] = str(o.id)
            return {"offers": [{"offer_id": state["offer_id"], "vendor_id": str(replacement.id),
                                "price": "2530.00", "terms": {}, "rank": 1}]}
        if tool == "negotiate":
            async with main.session_scope() as s:
                o = (await s.execute(
                    select(Offer).where(Offer.id == uuid.UUID(state["offer_id"]))
                )).scalar_one()
                o.price = Decimal("2300.00")
                o.status, o.is_winner = "accepted", True
            return {"winning_offer_id": state["offer_id"], "final_price": "2300.00", "rounds": []}
        if tool == "request_approval":
            return {"approval_id": str(uuid.uuid4()), "status": "pending"}
        raise AssertionError(f"unexpected tool {tool}")

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=fake_call)
    monkeypatch.setattr(main, "get_agents", lambda: agents)
    return agents


async def test_timeline_records_all_seven_steps_in_order(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    assert [entry["step"] for entry in out["timeline"]] == list(range(1, 8))
    assert [entry["name"] for entry in out["timeline"]] == STEP_NAMES
    assert all(entry["ts"] for entry in out["timeline"]), "every step carries its own timestamp"


async def test_old_booking_superseded_and_new_one_created(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    await session.refresh(booking)
    assert booking.status == "superseded"
    fresh = (await session.execute(
        select(Booking).where(Booking.production_id == production.id,
                              Booking.status == "confirmed")
    )).scalars().all()
    assert len(fresh) == 1
    assert fresh[0].final_price == Decimal("2300.00")


async def test_cost_delta_is_computed_from_db_state(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    recalc = next(e for e in out["timeline"] if e["name"] == "recalculate_cost")
    assert recalc["detail"]["old_total"] == "1900.00"
    assert recalc["detail"]["new_total"] == "2300.00"
    assert recalc["detail"]["delta"] == "400.00"


async def test_schedule_collision_is_reported(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    schedule = next(e for e in out["timeline"] if e["name"] == "check_schedule")
    assert schedule["detail"]["collisions"] == ["2026-09-02"]


async def test_diff_shows_old_versus_new(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    diff = next(e for e in out["timeline"] if e["name"] == "present_diff")
    assert diff["detail"]["old"]["vendor_name"] == "Dropout Cams"
    assert diff["detail"]["new"]["vendor_name"] == "Backup Cams"
    assert diff["detail"]["old"]["price"] == "1900.00"
    assert diff["detail"]["new"]["price"] == "2300.00"


async def test_over_threshold_delta_raises_approval(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    gate = next(e for e in out["timeline"] if e["name"] == "approval_gate")
    assert gate["detail"]["approval_required"] is True, \
        "1900 -> 2300 is a 21% delta, well over the 10% threshold"
    assert out["outcome"] == "awaiting_approval"

    event = (await session.execute(
        select(RecoveryEvent).where(RecoveryEvent.production_id == production.id)
    )).scalar_one()
    assert event.status == "awaiting_approval"


async def test_re_triggering_returns_the_existing_event(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    first = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    second = await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    assert second["recovery_event_id"] == first["recovery_event_id"]
    assert second["outcome"] == "already_in_progress"
    events = (await session.execute(
        select(RecoveryEvent).where(RecoveryEvent.production_id == production.id)
    )).scalars().all()
    assert len(events) == 1, "a fumbled re-trigger must not fork state"


async def test_the_brief_is_never_resubmitted(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    for call in replacement_agents.call.await_args_list:
        _, tool, args = call.args
        assert tool != "decompose_brief"
        assert "brief_text" not in args and "text" not in args
