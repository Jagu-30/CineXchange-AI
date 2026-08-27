STRATEGY = """You are negotiating on behalf of a film producer to procure: {category}.

Round {round_no} of {max_rounds}.
Vendor: {vendor_name} (rating {rating})
Their current asking price: {current_ask}
Your last offer: {last_offer}
Median market price for this category: {market_anchor}
Terms you may concede: flexible_dates, extended_rental_days, bundled_units

You do not know this vendor's walk-away price. Infer it from how they have moved.

Rules:
- On the final round, offer something they can realistically accept - an unclosed deal is worse
  than a slightly expensive one.
- Conceding a term is often cheaper than conceding cash. Use it.
- Set walk_away only if their ask is more than double the market anchor.

Return JSON only."""


def build(category: str, round_no: int, max_rounds: int, vendor_name: str,
          rating: str, current_ask: str, last_offer: str, market_anchor: str) -> str:
    return STRATEGY.format(
        category=category, round_no=round_no, max_rounds=max_rounds,
        vendor_name=vendor_name, rating=rating, current_ask=current_ask,
        last_offer=last_offer, market_anchor=market_anchor,
    )
