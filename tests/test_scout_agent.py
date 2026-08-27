import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Offer, Requirement, Vendor

pytestmark = pytest.mark.integration


@pytest.fixture
async def requirement(session, production):
    r = Requirement(production_id=production.id, category="camera",
                    spec={"model": "Alexa"}, quantity=1, priority=1)
    session.add(r)
    for i, (name, base, endpoint) in enumerate([
        ("Cheap Cams", "1000.00", "http://v1"),
        ("Mid Cams", "1500.00", "http://v2"),
        ("Lux Cams", "3000.00", "http://v3"),
    ]):
        session.add(Vendor(
            id=uuid.UUID(int=100 + i, version=4), name=name, category="camera",
            rating=Decimal("4.0"), base_price=Decimal(base),
            availability_calendar={"blocked": []}, contact_meta={"endpoint": endpoint},
        ))
    await session.commit()
    await session.refresh(r)
    return r


@pytest.fixture
def quoting_vendors(monkeypatch):
    from services.scout_agent import main

    async def fake_request(method, url, **kwargs):
        base = Decimal(kwargs["params"]["base_price"])
        return {"price": str(base * Decimal("1.15")), "terms": {"cancellation": "48h"},
                "available": True}

    monkeypatch.setattr(main, "request_with_retry", fake_request)


async def test_returns_offers_ranked_cheapest_first(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    out = await _find_vendors(str(requirement.id), [])
    prices = [Decimal(o["price"]) for o in out["offers"]]
    assert prices == sorted(prices), "ranking must put the best offer first"
    assert out["offers"][0]["rank"] == 1


async def test_excluded_vendor_is_never_offered(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    excluded = str(uuid.UUID(int=100, version=4))
    out = await _find_vendors(str(requirement.id), [excluded])
    assert excluded not in {o["vendor_id"] for o in out["offers"]}
    assert len(out["offers"]) == 2


async def test_unreachable_vendor_falls_back_to_base_price_and_is_flagged(
    session, requirement, monkeypatch
):
    from cinex.http import VendorUnavailable
    from services.scout_agent import main

    async def flaky(method, url, **kwargs):
        if "v2" in url:
            raise VendorUnavailable("down")
        base = Decimal(kwargs["params"]["base_price"])
        return {"price": str(base * Decimal("1.15")), "terms": {}, "available": True}

    monkeypatch.setattr(main, "request_with_retry", flaky)

    out = await main._find_vendors(str(requirement.id), [])
    fallbacks = [o for o in out["offers"] if o["terms"].get("fallback")]
    assert len(fallbacks) == 1, "the unreachable vendor still produces a list-price offer"
    assert Decimal(fallbacks[0]["price"]) == Decimal("1500.00")

    audits = (await session.execute(select(AuditLog))).scalars().all()
    assert any(a.action == "vendor_fallback" for a in audits), \
        "a fallback must be visible in the trace, never silent"


async def test_offers_are_persisted_as_pending(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    await _find_vendors(str(requirement.id), [])
    offers = (await session.execute(
        select(Offer).where(Offer.requirement_id == requirement.id)
    )).scalars().all()
    assert len(offers) == 3
    assert {o.status for o in offers} == {"pending"}
