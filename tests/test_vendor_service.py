import uuid

import httpx
import pytest

from services.vendor_mock.main import app, _disabled, _sessions
from services.vendor_mock.policy import derive_policy


@pytest.fixture(autouse=True)
def clear_sessions():
    # _disabled is process-local module state too: without this,
    # test_disabled_vendor_stops_quoting leaves VID dark for every later test.
    _sessions.clear()
    _disabled.clear()
    yield
    _sessions.clear()
    _disabled.clear()


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://vendor") as c:
        yield c


VID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"


async def test_quote_returns_list_price_above_base(client):
    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 2, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-03",
    })
    assert r.status_code == 200
    body = r.json()
    assert float(body["price"]) > 2000.0
    assert body["available"] is True


async def test_negotiation_state_advances_across_rounds(client):
    session_id = str(uuid.uuid4())
    prices = []
    for round_no in (1, 2):
        r = await client.post(f"/vendors/{VID}/negotiate", json={
            "session_id": session_id, "round": round_no,
            "price": "500.00", "terms": {}, "base_price": "2000.00",
        })
        body = r.json()
        if body["decision"] != "counter":
            break
        prices.append(float(body["price"]))
    assert len(prices) == 2, "expected two counters"
    assert prices[1] < prices[0], "vendor must actually concede between rounds"


async def test_disabled_vendor_stops_quoting(client):
    await client.post(f"/admin/vendors/{VID}/disable")
    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 1, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-03",
    })
    assert r.status_code == 503


async def test_response_body_never_contains_the_floor(client):
    policy = derive_policy(uuid.UUID(VID))
    reservation = 2000.0 * policy.floor_pct
    r = await client.post(f"/vendors/{VID}/negotiate", json={
        "session_id": str(uuid.uuid4()), "round": 1,
        "price": "100.00", "terms": {}, "base_price": "2000.00",
    })
    assert f"{reservation:.2f}" not in r.text


async def test_healthz(client):
    assert (await client.get("/healthz")).status_code == 200


async def test_quote_bills_the_shoot_window_inclusively(client):
    """Pricing and scheduling must count a window the same way.

    Pricing used to be exclusive - `(end - start).days` - while collision
    detection and the availability endpoint below were inclusive. A 1st-to-3rd
    shoot billed two days and blocked three, understating every quote (and so
    production.total_cost, and so the budget-cap approval gate) by a third.
    """
    from decimal import Decimal

    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 1, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-03",
    })
    body = r.json()
    assert body["terms"]["days"] == 3, "1st to 3rd inclusive is three shoot days"
    # 2000 * 1.15 list multiplier * 1 unit * 3 days
    assert Decimal(body["price"]) == Decimal("6900.00")


async def test_a_single_day_window_is_one_day(client):
    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 1, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-01",
    })
    assert r.json()["terms"]["days"] == 1


async def test_pricing_and_collision_detection_agree_on_the_day_count(client):
    """The two sides of the I6 disagreement, asserted against each other."""
    from datetime import date

    from services.recovery_agent.schedule import find_collisions

    start, end = date(2026, 9, 1), date(2026, 9, 3)
    every_day = ["2026-09-01", "2026-09-02", "2026-09-03"]
    blocked = find_collisions(every_day, start, end)

    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 1, "base_price": "2000.00",
        "start": start.isoformat(), "end": end.isoformat(),
    })
    assert r.json()["terms"]["days"] == len(blocked) == 3
