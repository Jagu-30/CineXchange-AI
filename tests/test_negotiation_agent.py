import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Offer, Requirement, Vendor
from cinex.schemas.agents import NegotiationStrategy

pytestmark = pytest.mark.integration


@pytest.fixture
async def offers(session, production):
    r = Requirement(production_id=production.id, category="camera", spec={}, quantity=1, priority=1)
    session.add(r)
    await session.flush()
    made = []
    for i, base in enumerate(["2000.00", "2400.00"]):
        v = Vendor(id=uuid.UUID(int=200 + i, version=4), name=f"V{i}", category="camera",
                   rating=Decimal("4.0"), base_price=Decimal(base),
                   availability_calendar={"blocked": []},
                   contact_meta={"endpoint": f"http://v{i}"})
        session.add(v)
        await session.flush()
        o = Offer(requirement_id=r.id, vendor_id=v.id,
                  price=Decimal(base) * Decimal("1.15"), terms={}, status="pending", round=0)
        session.add(o)
        await session.flush()
        made.append(o)
    await session.commit()
    return r, made


@pytest.fixture
def strategist(monkeypatch):
    from services.negotiation_agent import main
    llm = AsyncMock()
    llm.generate_json = AsyncMock(
        return_value=NegotiationStrategy(counter_price=1800.0, concede_terms=["flexible_dates"],
                                         walk_away=False, rationale="anchor below market")
    )
    monkeypatch.setattr(main, "get_llm", lambda: llm)
    return llm


async def test_converges_and_marks_a_single_winner(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers

    async def vendor(method, url, **kwargs):
        return {"decision": "accept", "price": kwargs["json"]["price"],
                "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    out = await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    assert out["winning_offer_id"] in {str(o.id) for o in made}
    rows = (await session.execute(
        select(Offer).where(Offer.requirement_id == r.id)
    )).scalars().all()
    assert sum(1 for o in rows if o.is_winner) == 1
    assert {o.status for o in rows} == {"accepted", "rejected"}


async def test_runs_multiple_rounds_when_the_vendor_counters(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers
    seen = []

    async def vendor(method, url, **kwargs):
        seen.append(kwargs["json"]["round"])
        if kwargs["json"]["round"] < 3:
            return {"decision": "counter", "price": "2100.00", "terms": {}, "message": "no"}
        return {"decision": "accept", "price": kwargs["json"]["price"], "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)
    assert max(seen) == 3, "must actually iterate rounds, not settle in one shot"


async def test_respects_the_round_cap(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers
    rounds = []

    async def stubborn(method, url, **kwargs):
        rounds.append(kwargs["json"]["round"])
        return {"decision": "counter", "price": "2200.00", "terms": {}, "message": "no"}

    monkeypatch.setattr(main, "request_with_retry", stubborn)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=2)
    assert max(rounds) == 2, "max_rounds must come from the caller, never a hardcoded 3"


async def test_every_round_is_audited(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers

    async def vendor(method, url, **kwargs):
        return {"decision": "accept", "price": kwargs["json"]["price"], "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    audits = (await session.execute(select(AuditLog))).scalars().all()
    round_entries = [a for a in audits if a.action == "negotiation_round"]
    assert len(round_entries) >= 2, "one entry per vendor per round, minimum"
    assert all("offered" in a.payload and "decision" in a.payload for a in round_entries)


async def test_all_vendors_rejecting_falls_back_to_the_best_standing_offer(
    session, offers, strategist, monkeypatch
):
    from services.negotiation_agent import main
    r, made = offers

    async def refusing(method, url, **kwargs):
        return {"decision": "reject", "price": "9999.00", "terms": {}, "message": "no"}

    monkeypatch.setattr(main, "request_with_retry", refusing)
    out = await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=2)
    assert out["winning_offer_id"] is not None, "a rejection round must not leave the requirement empty"
