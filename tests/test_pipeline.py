import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import Approval, Booking, Offer, Production, Requirement, Vendor
from cinex.steps import read_steps

pytestmark = pytest.mark.integration


@pytest.fixture
async def wired(session, production, monkeypatch):
    """Fake the five agents. The pipeline's own sequencing is what is under test."""
    from services.orchestrator import pipeline

    vendor = Vendor(id=uuid.uuid4(), name="V", category="camera", rating=Decimal("4.0"),
                    base_price=Decimal("2000.00"), availability_calendar={"blocked": []},
                    contact_meta={"endpoint": "http://v1"})
    session.add(vendor)
    await session.commit()

    state = {}

    async def fake_call(agent, tool, args):
        if tool == "decompose_brief":
            async with pipeline.session_scope() as s:
                r = Requirement(production_id=production.id, category="camera",
                                spec={}, quantity=1, priority=1)
                s.add(r)
                await s.flush()
                state["requirement_id"] = str(r.id)
            return {"requirements": [{"requirement_id": state["requirement_id"],
                                      "category": "camera", "spec": {},
                                      "quantity": 1, "priority": 1}]}
        if tool == "find_vendors":
            async with pipeline.session_scope() as s:
                o = Offer(requirement_id=uuid.UUID(args["requirement_id"]),
                          vendor_id=vendor.id, price=Decimal("2300.00"),
                          terms={}, status="pending", round=0)
                s.add(o)
                await s.flush()
                state["offer_id"] = str(o.id)
            return {"offers": [{"offer_id": state["offer_id"], "vendor_id": str(vendor.id),
                                "price": "2300.00", "terms": {}, "rank": 1}]}
        if tool == "negotiate":
            async with pipeline.session_scope() as s:
                o = (await s.execute(
                    select(Offer).where(Offer.id == uuid.UUID(state["offer_id"]))
                )).scalar_one()
                o.price = Decimal("1900.00")
                o.status, o.is_winner = "accepted", True
            return {"winning_offer_id": state["offer_id"], "final_price": "1900.00", "rounds": []}
        if tool == "check_compliance":
            return {"checks": [{"check_type": "permit", "status": "pass", "evidence": {}}],
                    "overall": "pass"}
        if tool == "request_approval":
            return {"approval_id": str(uuid.uuid4()), "status": "pending"}
        raise AssertionError(f"unexpected tool {tool}")

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=fake_call)
    monkeypatch.setattr(pipeline, "get_agents", lambda: agents)
    return production, agents, state


async def test_all_ten_steps_are_emitted_in_order(session, wired):
    from services.orchestrator.pipeline import STEPS, run_happy_path
    production, _, _ = wired

    await run_happy_path(production.id)

    steps = await read_steps(session, production.id)
    done = [s.step for s in steps if s.status == "done"]
    assert done == [n for n, _ in STEPS], "every step must report done, in order"


async def test_happy_path_creates_a_booking(session, wired):
    from services.orchestrator.pipeline import run_happy_path
    production, _, _ = wired

    await run_happy_path(production.id)

    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == production.id)
    )).scalars().all()
    assert len(bookings) == 1
    assert bookings[0].final_price == Decimal("1900.00")
    assert bookings[0].status == "confirmed"

    await session.refresh(production)
    assert production.status == "booked"
    assert production.total_cost == Decimal("1900.00")


async def test_over_budget_parks_at_awaiting_approval_and_books_nothing(session, production, wired, monkeypatch):
    from services.orchestrator import pipeline
    prod, agents, _ = wired

    async with pipeline.session_scope() as s:
        p = (await s.execute(select(Production).where(Production.id == prod.id))).scalar_one()
        p.budget_cap = Decimal("100.00")

    await pipeline.run_happy_path(prod.id)

    await session.refresh(prod)
    assert prod.status == "awaiting_approval"
    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == prod.id)
    )).scalars().all()
    assert bookings == [], "nothing may be booked while an approval is pending"


async def test_resume_after_approval_books(session, production, wired):
    from services.orchestrator import pipeline
    prod, _, _ = wired

    async with pipeline.session_scope() as s:
        p = (await s.execute(select(Production).where(Production.id == prod.id))).scalar_one()
        p.budget_cap = Decimal("100.00")

    await pipeline.run_happy_path(prod.id)
    await pipeline.resume_after_approval(prod.id)

    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == prod.id)
    )).scalars().all()
    assert len(bookings) == 1


async def test_agent_failure_marks_the_production_failed(session, production, monkeypatch):
    from cinex.mcp_client import AgentUnavailable
    from services.orchestrator import pipeline

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=AgentUnavailable("producer-agent down"))
    monkeypatch.setattr(pipeline, "get_agents", lambda: agents)

    await pipeline.run_happy_path(production.id)

    await session.refresh(production)
    assert production.status == "failed"
    steps = await read_steps(session, production.id)
    assert any(s.status == "failed" for s in steps), "a failure must be visible on the stream"
