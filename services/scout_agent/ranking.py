"""Offer ranking. Pure, so the weighting is testable and arguable on stage."""
from decimal import Decimal

PRICE_WEIGHT = 0.6
RATING_WEIGHT = 0.4
UNAVAILABLE_PENALTY = 1000.0


def score(price: Decimal, rating: Decimal, available: bool, cheapest: Decimal) -> float:
    """Higher is better. Price is scored relative to the cheapest quote in the set."""
    price_ratio = float(cheapest / price) if price > 0 else 0.0
    rating_ratio = float(rating) / 5.0
    base = PRICE_WEIGHT * price_ratio + RATING_WEIGHT * rating_ratio
    return base - (0.0 if available else UNAVAILABLE_PENALTY)
