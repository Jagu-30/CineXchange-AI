import pytest
from sqlalchemy import select

from cinex.db.models import Vendor
from seeds.seed import load_vendor_records, seed_vendors

pytestmark = pytest.mark.integration

CATEGORIES = {"camera", "crew", "location", "transport", "insurance", "permit"}


def test_seed_file_covers_every_category_with_competition():
    records = load_vendor_records()
    by_category: dict[str, int] = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    assert set(by_category) == CATEGORIES
    assert all(count >= 2 for count in by_category.values()), \
        "every category needs at least two vendors or there is nothing to negotiate between"


def test_seed_file_spreads_across_three_endpoints():
    endpoints = {r["contact_meta"]["endpoint"] for r in load_vendor_records()}
    assert len(endpoints) == 3


async def test_seeding_is_idempotent(session):
    first = await seed_vendors(session)
    await session.commit()
    second = await seed_vendors(session)
    await session.commit()
    total = len((await session.execute(select(Vendor))).scalars().all())
    assert first > 0
    assert second == 0, "re-seeding must not duplicate vendors"
    assert total == first
