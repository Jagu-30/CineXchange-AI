import uuid
from decimal import Decimal

import pytest

from cinex.audit import write_audit
from cinex.steps import emit_step, read_steps

pytestmark = pytest.mark.integration


async def test_write_audit_persists_actor_and_payload(session):
    entity = uuid.uuid4()
    row = await write_audit(
        session, actor="negotiation-agent", action="round.counter",
        entity_type="offer", entity_id=entity, payload={"price": Decimal("1900.00")},
    )
    await session.commit()
    assert row.actor == "negotiation-agent"
    assert row.payload["price"] == "1900.00", "Decimal must survive as an exact string, not a float"


async def test_steps_are_readable_in_order(session, production):
    await emit_step(session, production.id, 2, "decompose", "in_progress")
    await emit_step(session, production.id, 2, "decompose", "done", {"requirements": 6})
    await session.commit()

    steps = await read_steps(session, production.id)
    assert [(s.step, s.status) for s in steps] == [(2, "in_progress"), (2, "done")]
    assert steps[-1].detail == {"requirements": 6}


async def test_read_steps_after_cursor_returns_only_newer(session, production):
    await emit_step(session, production.id, 1, "ingest", "done")
    await session.commit()
    first = (await read_steps(session, production.id))[-1]

    await emit_step(session, production.id, 2, "decompose", "done")
    await session.commit()

    later = await read_steps(session, production.id, after_seq=first.seq)
    assert [s.step for s in later] == [2]


async def test_step_order_is_stable_within_a_single_transaction(session, production):
    """created_at cannot order an append-only log: Postgres func.now() is
    transaction-start time, and wall-clock ties on Windows. seq is monotonic."""
    for i in range(20):
        await emit_step(session, production.id, i, f"s{i}", "done")
    await session.commit()

    steps = await read_steps(session, production.id)
    assert [s.step for s in steps] == list(range(20))
    assert [s.seq for s in steps] == sorted(s.seq for s in steps)
