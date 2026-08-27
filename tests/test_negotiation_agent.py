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


# --- C3: an LLMError must not erase the audit for rounds already conducted ---


async def test_an_llm_failure_partway_leaves_the_completed_rounds_audited(
    session, offers, monkeypatch,
):
    """Vendor state is not transactional. Rounds that happened, happened.

    Offer 1 settles in one round against a vendor whose concession ladder has
    really advanced. Offer 2's very first LLM call then dies. Holding one
    transaction across the whole cartesian rolled the first offer's audit row
    back with it: real decisions, zero audit.
    """
    from cinex.llm.gemini import LLMError
    from services.negotiation_agent import main
    r, made = offers

    calls = {"n": 0}
    llm = AsyncMock()

    async def flaky(prompt, schema):
        calls["n"] += 1
        if calls["n"] > 1:
            raise LLMError("gemini timed out after 30.0s")
        return NegotiationStrategy(counter_price=1800.0, concede_terms=[],
                                   walk_away=False, rationale="anchor below market")

    llm.generate_json = AsyncMock(side_effect=flaky)
    monkeypatch.setattr(main, "get_llm", lambda: llm)

    async def vendor(method, url, **kwargs):
        return {"decision": "accept", "price": kwargs["json"]["price"],
                "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)

    with pytest.raises(LLMError):
        await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    audits = (await session.execute(select(AuditLog).order_by(AuditLog.seq))).scalars().all()
    rounds = [a for a in audits if a.action == "negotiation_round"]
    assert len(rounds) == 1, \
        "the round that really happened must survive the later failure"
    assert rounds[0].payload["decision"] == "accept"

    failures = [a for a in audits if a.action == "negotiate_failed"]
    assert len(failures) == 1, "and the failure itself must be audited, never silent"
    assert failures[0].payload["completed_rounds"] == 1


async def test_an_accepted_price_is_durable_before_the_next_offer_is_touched(
    session, offers, monkeypatch,
):
    from cinex.llm.gemini import LLMError
    from services.negotiation_agent import main
    r, made = offers

    calls = {"n": 0}
    llm = AsyncMock()

    async def flaky(prompt, schema):
        calls["n"] += 1
        if calls["n"] > 1:
            raise LLMError("boom")
        return NegotiationStrategy(counter_price=1800.0, concede_terms=[],
                                   walk_away=False, rationale="x")

    llm.generate_json = AsyncMock(side_effect=flaky)
    monkeypatch.setattr(main, "get_llm", lambda: llm)
    monkeypatch.setattr(main, "request_with_retry", lambda method, url, **kw: _accept(kw))

    with pytest.raises(LLMError):
        await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    settled_offer = (await session.execute(
        select(Offer).where(Offer.id == made[0].id)
    )).scalar_one()
    assert settled_offer.price == Decimal("1800.00"), \
        "the agreed price the vendor accepted must not be rolled back"


async def _accept(kw):
    return {"decision": "accept", "price": kw["json"]["price"], "terms": {}, "message": "ok"}


# --- I3: winner selection must not promote an unreachable vendor ---


def test_a_settled_outcome_beats_a_cheaper_unsettled_one():
    from services.negotiation_agent.main import pick_winner

    settled = {"offer_id": "settled", "settled": True, "reachable": True, "price": Decimal("2000")}
    standing = {"offer_id": "standing", "settled": False, "reachable": True, "price": Decimal("1000")}
    assert pick_winner([standing, settled])["offer_id"] == "settled"


def test_an_unreachable_vendor_never_wins_over_one_that_answered():
    """The dead vendor's outcome carries its original quote, which under a flat
    min(price) could beat every vendor that actually talked to us."""
    from services.negotiation_agent.main import pick_winner

    dead = {"offer_id": "dead", "settled": False, "reachable": False, "price": Decimal("500")}
    alive = {"offer_id": "alive", "settled": False, "reachable": True, "price": Decimal("2400")}
    assert pick_winner([dead, alive])["offer_id"] == "alive"


def test_an_unreachable_vendor_is_still_a_last_resort():
    from services.negotiation_agent.main import pick_winner

    dead = {"offer_id": "dead", "settled": False, "reachable": False, "price": Decimal("500")}
    assert pick_winner([dead])["offer_id"] == "dead"


def test_best_standing_offer_wins_when_nothing_settled():
    from services.negotiation_agent.main import pick_winner

    a = {"offer_id": "a", "settled": False, "reachable": True, "price": Decimal("2400")}
    b = {"offer_id": "b", "settled": False, "reachable": True, "price": Decimal("2300")}
    assert pick_winner([a, b])["offer_id"] == "b"
