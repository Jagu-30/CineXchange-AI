import uuid

import httpx
import pytest

from services.vendor_mock.main import app, _sessions
from services.vendor_mock.policy import derive_policy


@pytest.fixture(autouse=True)
def clear_sessions():
    _sessions.clear()
    yield
    _sessions.clear()


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
