"""The one place a shoot window is turned into days and a list price.

Two separate defects came out of this arithmetic living in more than one file:
pricing counted days exclusively while scheduling counted them inclusively, and
scout-agent's vendor-unavailable fallback quoted a bare ``base_price`` that no
real quote could ever match. Both now derive from here, so the fallback is
priced on exactly the same basis as a live quote and a window means the same
number of days to everyone.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

LIST_MULTIPLIER = Decimal("1.15")
CENTS = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def shoot_days(start: date, end: date) -> int:
    """Inclusive of both ends: 2026-09-01..2026-09-03 is a three-day shoot.

    Inclusive is the natural reading of a shoot window and is what collision
    detection (``recovery_agent.schedule.find_collisions``) and the vendor
    availability endpoint have always used. Pricing used to count exclusively,
    which under-billed a three-day shoot by a third and fed the budget-cap
    approval gate a number a third too low.
    """
    return max((end - start).days + 1, 1)


def opening_ask(base_price: Decimal) -> Decimal:
    """A vendor's per-unit, per-day list price: base plus the list markup."""
    return money(base_price * LIST_MULTIPLIER)


def list_price(base_price: Decimal, quantity: int, start: date, end: date) -> Decimal:
    """The full list quote for a requirement over a shoot window.

    This is what a reachable vendor quotes, so it is also what an unreachable
    one has to be assumed to want - anything cheaper would make going dark the
    winning strategy.
    """
    return money(opening_ask(base_price) * quantity * shoot_days(start, end))
