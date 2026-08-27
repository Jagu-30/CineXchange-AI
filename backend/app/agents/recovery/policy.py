from typing import Tuple, List

class RecoveryPolicy:
    """Deterministic policy rules for emergency equipment recovery."""

    @staticmethod
    def requires_approval_for_cost_delta(cost_delta: float, threshold: float = 0.0) -> bool:
        """Any positive cost delta over original contract line requires explicit producer authorization."""
        return cost_delta > threshold

    @staticmethod
    def validate_recovery_candidate(
        compatibility_score: float,
        is_available: bool,
        schedule_delay_days: int
    ) -> Tuple[bool, List[str]]:
        reasons = []
        if not is_available:
            reasons.append("Replacement candidate is currently unavailable")
        if compatibility_score < 70.0:
            reasons.append(f"Compatibility score ({compatibility_score:.1f}) is insufficient")
        if schedule_delay_days > 1:
            reasons.append(f"Schedule delay ({schedule_delay_days} days) causes catastrophic production stoppage")

        return len(reasons) == 0, reasons
