from typing import List, Tuple
from backend.app.agents.common.schemas import CandidateVendor, ScoredCandidate
from backend.app.agents.common.policies import PolicyEngine
from backend.app.agents.common.evaluator import MultiCriteriaEvaluator

class ScoutRanker:
    """Applies hard constraints and weighted multi-criteria ranking to candidate vendors."""

    @staticmethod
    def rank_candidates(
        candidates: List[CandidateVendor],
        remaining_budget: float,
        require_low_light: bool = True
    ) -> Tuple[List[ScoredCandidate], List[ScoredCandidate]]:
        recommendations: List[ScoredCandidate] = []
        rejected: List[ScoredCandidate] = []

        for cand in candidates:
            passed, reasons, rejected_reasons = PolicyEngine.check_hard_filters(
                candidate=cand,
                budget_remaining=remaining_budget,
                require_low_light=require_low_light
            )

            score, breakdown = MultiCriteriaEvaluator.score_scout_candidate(
                candidate=cand,
                max_budget=remaining_budget
            )

            scored = ScoredCandidate(
                candidate=cand,
                hard_constraints_passed=passed,
                score=score if passed else max(0.0, score - 30.0),
                score_breakdown=breakdown,
                reasons=reasons,
                rejected_reasons=rejected_reasons
            )

            if passed:
                recommendations.append(scored)
            else:
                rejected.append(scored)

        # Sort recommendations descending by score
        recommendations.sort(key=lambda x: x.score, reverse=True)
        rejected.sort(key=lambda x: x.score, reverse=True)

        return recommendations, rejected
