from typing import Tuple, List
from backend.app.config import settings

class NegotiationPolicy:
    """Deterministic policy rules for price negotiations."""

    @staticmethod
    def validate_offer(
        price: float,
        insurance_included: bool,
        quality_score: float,
        delivery_days: int,
        round_number: int,
        max_rounds: int = 3
    ) -> Tuple[bool, List[str]]:
        rejection_reasons = []

        if not insurance_included:
            rejection_reasons.append("Rejected: Offer lacks mandatory on-site equipment & crew insurance.")

        if quality_score < settings.MIN_ACCEPTABLE_QUALITY:
            rejection_reasons.append(f"Rejected: Quality score {quality_score:.1f} < minimum threshold {settings.MIN_ACCEPTABLE_QUALITY}.")

        if delivery_days > 2:
            rejection_reasons.append(f"Rejected: Delivery window ({delivery_days} days) exceeds 2-day maximum.")

        if round_number > max_rounds:
            rejection_reasons.append(f"Rejected: Negotiation exceeded maximum allowable rounds ({max_rounds}).")

        return len(rejection_reasons) == 0, rejection_reasons

    @staticmethod
    def can_auto_accept(
        initial_price: float,
        offered_price: float,
        target_savings_percent: float = 8.0
    ) -> bool:
        if initial_price <= 0:
            return False
        savings_pct = ((initial_price - offered_price) / initial_price) * 100.0
        return savings_pct >= target_savings_percent
