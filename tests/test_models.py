import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinex.db.models import Base, Offer, Production, Requirement, Vendor

pytestmark = pytest.mark.integration

import os

DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://cinex:cinex@localhost:5433/cinex_test",
)


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


async def test_production_defaults_and_money_precision(session):
    p = Production(
        producer_id=uuid.uuid4(),
        brief_text="a 3-day shoot in Lisbon",
        budget_cap=Decimal("120000.00"),
        location="Lisbon",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 3),
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    assert p.status == "draft"
    assert p.current_step == 0
    assert p.created_at is not None and p.created_at.tzinfo is not None
    assert p.budget_cap == Decimal("120000.00")


async def test_offer_belongs_to_requirement_and_vendor(session):
    p = Production(
        producer_id=uuid.uuid4(), brief_text="b", budget_cap=Decimal("1000.00"),
        location="Lisbon", start_date=date(2026, 9, 1), end_date=date(2026, 9, 3),
    )
    session.add(p)
    await session.flush()
    r = Requirement(production_id=p.id, category="camera", spec={"model": "Alexa"}, quantity=2, priority=1)
    v = Vendor(
        name="Lisbon Camera Co", category="camera", rating=Decimal("4.5"),
        base_price=Decimal("2000.00"), availability_calendar={"blocked": []},
        contact_meta={"endpoint": "http://vendor-mock-1:9001"},
    )
    session.add_all([r, v])
    await session.flush()
    o = Offer(requirement_id=r.id, vendor_id=v.id, price=Decimal("1900.00"), terms={}, status="pending", round=0)
    session.add(o)
    await session.commit()
    await session.refresh(o)
    assert o.status == "pending"
    assert o.is_winner is False
