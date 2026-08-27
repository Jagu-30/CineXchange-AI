import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinex.db.models import Base, Production

DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://cinex:cinex@localhost:5433/cinex_test",
)

# The `session` fixture calls drop_all, so the suite must be structurally
# incapable of pointing at anything but the test database. Force it rather than
# setdefault: a stray exported DATABASE_URL would otherwise get its tables
# dropped. Developers override the target via TEST_DATABASE_URL, which DSN reads.
os.environ["DATABASE_URL"] = DSN


@pytest.fixture
async def session():
    engine = create_async_engine(DSN)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        # Agents under test open their own session against a *different* engine
        # (cinex.db.session.session_scope) and commit independently. With
        # expire_on_commit=False (required for async - accessing an expired
        # attribute after commit would need a synchronous lazy-load), a plain
        # select() here would otherwise return this session's stale, already
        # cached-by-identity-map objects instead of what the agent just wrote.
        # Force every SELECT issued through this test session to re-populate
        # from the row actually on disk, so assertions see reality.
        @event.listens_for(s.sync_session, "do_orm_execute")
        def _populate_existing(execute_state):
            if execute_state.is_select:
                execute_state.update_execution_options(populate_existing=True)

        yield s
    await engine.dispose()


@pytest.fixture
async def production(session):
    p = Production(
        producer_id=uuid.uuid4(),
        brief_text="3-day commercial shoot in Lisbon, two camera crews, drone work",
        budget_cap=Decimal("120000.00"),
        location="Lisbon",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 3),
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p
