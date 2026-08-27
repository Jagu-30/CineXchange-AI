"""Vendor-side negotiation logic.

Everything here stays inside the vendor process. The reservation price is never
serialised into a response, a log line, or an audit payload - the negotiating
agent runs in a different container and provably cannot read it.
"""
import random
import uuid
from dataclasses import dataclass
from decimal import Decimal

from cinex.pricing import CENTS, LIST_MULTIPLIER, list_price, money as _money, opening_ask

MAX_BUNDLE_DISCOUNT = Decimal("0.05")
CONCEDABLE_TERMS = frozenset({"flexible_dates", "extended_rental_days", "bundled_units"})

# LIST_MULTIPLIER, CENTS, _money and opening_ask moved to cinex.pricing so the
# vendor's list price and scout-agent's unavailable-vendor fallback derive from
# one rule instead of two copies of a magic 1.15. Re-exported here because this
# module is the vendor's public policy surface.
__all__ = [
    "CENTS", "CONCEDABLE_TERMS", "LIST_MULTIPLIER", "MAX_BUNDLE_DISCOUNT",
    "VendorDecision", "VendorPolicy", "derive_policy", "list_price", "opening_ask", "respond",
]


@dataclass(frozen=True)
class VendorPolicy:
    floor_pct: float
    concession_rate: float
    bundle_appetite: float
    patience: int


@dataclass(frozen=True)
class VendorDecision:
    decision: str          # accept | counter | reject
    price: Decimal
    terms: dict
    message: str


def derive_policy(vendor_id: uuid.UUID) -> VendorPolicy:
    rng = random.Random(vendor_id.int)
    return VendorPolicy(
        floor_pct=rng.uniform(0.72, 0.88),
        concession_rate=rng.uniform(0.25, 0.55),
        bundle_appetite=rng.uniform(0.0, 1.0),
        patience=rng.randint(2, 4),
    )


def _reservation(policy: VendorPolicy, base_price: Decimal, offer_terms: dict) -> Decimal:
    reservation = base_price * Decimal(str(policy.floor_pct))
    conceded = [t for t in CONCEDABLE_TERMS if offer_terms.get(t)]
    if conceded and policy.bundle_appetite > 0.5:
        appetite = Decimal(str(policy.bundle_appetite))
        # Interpolate over [0.5*MAX, MAX] rather than [0, MAX]: a linear-from-zero
        # scaling let a barely-eligible vendor's discount shrink toward 0, which is
        # too small to ever move a near-reservation offer into acceptance.
        discount = MAX_BUNDLE_DISCOUNT * (Decimal("0.5") + Decimal("0.5") * appetite)
        reservation *= Decimal("1") - discount
    return reservation


def respond(
    policy: VendorPolicy,
    base_price: Decimal,
    current_ask: Decimal,
    offer_price: Decimal,
    offer_terms: dict,
    round_no: int,
) -> VendorDecision:
    reservation = _reservation(policy, base_price, offer_terms)

    if offer_price >= reservation:
        return VendorDecision("accept", _money(offer_price), dict(offer_terms), "Agreed. Booking confirmed.")

    if round_no > policy.patience:
        return VendorDecision(
            "reject", _money(current_ask), {}, "We can't go lower on this one. Withdrawing."
        )

    target = max(reservation, offer_price)
    new_ask = current_ask - Decimal(str(policy.concession_rate)) * (current_ask - target)
    return VendorDecision(
        "counter",
        _money(new_ask),
        {"valid_rounds": 1},
        "That's below what we can do, but here's an improved number.",
    )
