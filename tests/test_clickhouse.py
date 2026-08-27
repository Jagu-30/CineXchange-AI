import uuid
from decimal import Decimal

import pytest

from cinex.clickhouse import (
    cost_delta_history, init_clickhouse, median_price, record_offer_event,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def schema():
    await init_clickhouse()


async def test_median_price_of_recorded_offers():
    category = f"probe-{uuid.uuid4().hex[:8]}"
    for price in ("100.00", "200.00", "300.00"):
        await record_offer_event(category, uuid.uuid4(), Decimal(price), "quote")
    assert await median_price(category) == Decimal("200.00")


async def test_median_of_an_unknown_category_is_zero_not_an_error():
    assert await median_price("nothing-here") == Decimal("0")


async def test_a_clickhouse_outage_never_breaks_the_caller(monkeypatch):
    import cinex.clickhouse as ch

    def explode(*_args, **_kwargs):
        raise ConnectionError("clickhouse is down")

    monkeypatch.setattr(ch, "_client", explode)
    await record_offer_event("camera", uuid.uuid4(), Decimal("1"), "quote")  # must not raise


async def test_cost_delta_history_returns_recorded_totals():
    production_id = uuid.uuid4()
    await record_offer_event("camera", uuid.uuid4(), Decimal("1900.00"), "booking",
                             production_id=production_id)
    await record_offer_event("camera", uuid.uuid4(), Decimal("2300.00"), "recovery_booking",
                             production_id=production_id)
    history = await cost_delta_history(production_id)
    assert [h["kind"] for h in history] == ["booking", "recovery_booking"]
