from typing import List, Tuple
from backend.app.agents.common.schemas import CandidateVendor, RecoveryOption
from backend.app.agents.common.evaluator import MultiCriteriaEvaluator
from backend.app.agents.recovery.compatibility import TechnicalCompatibilityScorer

class RecoveryEngine:
    """Evaluates and ranks alternative equipment packages during active shoot emergencies."""

    @staticmethod
    def rank_recovery_candidates(
        original_resource_id: str,
        original_price: float,
        target_specs: dict,
        candidates: List[CandidateVendor]
    ) -> List[RecoveryOption]:
        options: List[RecoveryOption] = []

        for cand in candidates:
            # Skip the failed original resource itself
            if cand.resource_id == original_resource_id:
                continue

            # Only consider same category / resource_type
            if cand.resource_type != "CAMERA":
                continue

            compat_score, _ = TechnicalCompatibilityScorer.score_camera_compatibility(
                target_specs=target_specs,
                candidate=cand
            )

            # Schedule delay: delivery_days 0 = 0 delay, 1 = 0 delay (next morning), >1 = delay
            delay_days = max(0, cand.delivery_days - 0) if cand.delivery_days > 0 else 0

            option = MultiCriteriaEvaluator.score_recovery_option(
                candidate=cand,
                original_price=original_price,
                compatibility_score=compat_score,
                schedule_delay_days=delay_days
            )
            options.append(option)

        # Sort descending by total score
        options.sort(key=lambda x: x.total_score, reverse=True)
        return options
