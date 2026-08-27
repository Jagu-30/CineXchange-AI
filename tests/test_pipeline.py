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


# --- I4: a terminal status must never be visible before the rows that explain it ---


async def test_terminal_status_and_its_final_step_rows_commit_together(session, wired, monkeypatch):
    """Atomicity, proved by breaking the last write.

    If step 10's `terminal` row and `production.status = "booked"` share one
    transaction, killing the row must take the status with it. Before the fix
    the status had already committed two transactions earlier, so an SSE poll
    landing in that window closed the stream without ever sending step 10.
    """
    from services.orchestrator import pipeline
    production, _, _ = wired
    real_emit = pipeline.emit_step

    async def boom(sess, pid, number, name, status, detail=None):
        if number == 10 and status == "terminal":
            raise RuntimeError("crash after the status flip")
        return await real_emit(sess, pid, number, name, status, detail)

    monkeypatch.setattr(pipeline, "emit_step", boom)
    await pipeline.run_happy_path(production.id)

    await session.refresh(production)
    assert production.status != "booked", \
        "status must not survive a transaction whose step rows did not"

    steps = await read_steps(session, production.id)
    assert not [s for s in steps if s.step == 10 and s.status == "done"], \
        "the step-10 done row went back with the same transaction"


async def test_failure_reason_and_failed_status_commit_together(session, production, monkeypatch):
    """_fail's payload carries the *reason*. Committing the status first let the
    stream close having never told the producer why."""
    from cinex.mcp_client import AgentUnavailable
    from services.orchestrator import pipeline

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=AgentUnavailable("producer-agent down"))
    monkeypatch.setattr(pipeline, "get_agents", lambda: agents)

    real_emit = pipeline.emit_step

    async def boom(sess, pid, number, name, status, detail=None):
        if status == "failed":
            raise RuntimeError("crash after the status flip")
        return await real_emit(sess, pid, number, name, status, detail)

    monkeypatch.setattr(pipeline, "emit_step", boom)
    with pytest.raises(RuntimeError):
        await pipeline.run_happy_path(production.id)

    await session.refresh(production)
    assert production.status != "failed", \
        "a failed status without its reason row must not be visible"


async def test_stream_emits_every_step_row_that_exists_before_it_ends(session, wired, monkeypatch):
    """The SSE contract: /events and /status cannot disagree."""
    import asyncio
    import json

    import httpx

    from services.orchestrator import main as api
    from services.orchestrator import pipeline
    production, _, _ = wired

    monkeypatch.setattr(api, "SSE_POLL_SECONDS", 0.02)
    emitted: list[int] = []

    transport = httpx.ASGITransport(app=api.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api", timeout=60) as c:
        async def drive():
            await asyncio.sleep(0.05)
            await pipeline.run_happy_path(production.id)

        task = asyncio.create_task(drive())
        async with c.stream("GET", f"/productions/{production.id}/events") as response:
            async for line in response.aiter_lines():
                if line.startswith("data: ") and "\"seq\"" in line:
                    emitted.append(json.loads(line[len("data: "):])["seq"])
                if line.startswith("event: end"):
                    break
        await task

    steps = await read_steps(session, production.id)
    assert steps, "the pipeline must have produced step rows"
    assert emitted == [s.seq for s in steps], (
        "the stream closed without emitting every step row /status would show: "
        f"missing {sorted(set(s.seq for s in steps) - set(emitted))}"
    )


# --- I8: one definition of total cost, shared ---


def test_orchestrator_and_recovery_share_one_total_cost_definition():
    from cinex.costing import total_cost
    from services.orchestrator import pipeline
    from services.recovery_agent import main as recovery

    assert pipeline.total_cost is total_cost
    assert recovery.total_cost is total_cost
