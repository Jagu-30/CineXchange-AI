import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinex.db.models import Base, Production

import os

DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://cinex:cinex@localhost:5433/cinex_test",
)

# cinex.config.Settings.database_url normally comes from .env (the "cinex" dev
# database). Agent code that reaches the DB through cinex.db.session.session_scope()
# (rather than through the `session` fixture directly) resolves DATABASE_URL via
# get_settings(), so without this it would write to a different physical database
# than the one this fixture just seeded, producing a ForeignKeyViolationError.
# setdefault so an explicit developer override of DATABASE_URL still wins.
os.environ.setdefault("DATABASE_URL", DSN)


@pytest.fixture
async def session():
    engine = create_async_engine(DSN)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
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
