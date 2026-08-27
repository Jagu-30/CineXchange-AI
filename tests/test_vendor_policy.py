import uuid
from decimal import Decimal

from services.vendor_mock.policy import (
    CONCEDABLE_TERMS, derive_policy, opening_ask, respond,
)

BASE = Decimal("2000.00")


def test_policy_is_deterministic_for_a_vendor_id():
    vid = uuid.UUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
    assert derive_policy(vid) == derive_policy(vid)


def test_policy_differs_across_vendors():
    a = derive_policy(uuid.UUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301"))
    b = derive_policy(uuid.UUID("aaaaaaaa-4f89-11d3-9a0c-0305e82c3301"))
    assert a != b


def test_accepts_offer_at_or_above_reservation():
    policy = derive_policy(uuid.uuid4())
    reservation = BASE * Decimal(str(policy.floor_pct))
    decision = respond(policy, BASE, opening_ask(BASE), reservation, {}, 1)
    assert decision.decision == "accept"


def test_never_counters_below_reservation_across_many_seeds_and_rounds():
    """The invariant the demo's credibility depends on."""
    for i in range(200):
        vid = uuid.UUID(int=i, version=4)
        policy = derive_policy(vid)
        reservation = BASE * Decimal(str(policy.floor_pct))
        ask = opening_ask(BASE)
        lowball = BASE * Decimal("0.10")
        for round_no in range(1, 11):
            decision = respond(policy, BASE, ask, lowball, {}, round_no)
            if decision.decision == "counter":
                assert decision.price >= reservation, (
                    f"vendor {vid} crossed its floor at round {round_no}"
                )
                ask = decision.price
            else:
                break


def test_holds_firm_and_rejects_once_patience_is_exhausted():
    policy = derive_policy(uuid.uuid4())
    lowball = BASE * Decimal("0.10")
    decision = respond(policy, BASE, opening_ask(BASE), lowball, {}, policy.patience + 1)
    assert decision.decision == "reject"


def test_conceded_terms_lower_the_effective_reservation_for_receptive_vendors():
    """Find a vendor with appetite, then show a term concession buys a lower price."""
    policy = next(
        derive_policy(uuid.UUID(int=i, version=4))
        for i in range(500)
        if derive_policy(uuid.UUID(int=i, version=4)).bundle_appetite > 0.5
    )
    reservation = BASE * Decimal(str(policy.floor_pct))
    just_under = reservation * Decimal("0.97")

    without = respond(policy, BASE, opening_ask(BASE), just_under, {}, 1)
    with_bundle = respond(
        policy, BASE, opening_ask(BASE), just_under, {next(iter(CONCEDABLE_TERMS)): True}, 1
    )
    assert without.decision == "counter"
    assert with_bundle.decision == "accept"


def test_response_never_leaks_the_reservation_price():
    policy = derive_policy(uuid.uuid4())
    decision = respond(policy, BASE, opening_ask(BASE), BASE * Decimal("0.10"), {}, 1)
    serialised = f"{decision.terms}{decision.message}".lower()
    assert "reservation" not in serialised and "floor" not in serialised
