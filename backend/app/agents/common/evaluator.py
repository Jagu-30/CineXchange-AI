from typing import Dict, Tuple
from backend.app.agents.common.schemas import CandidateVendor, ScoredCandidate, RecoveryOption

class MultiCriteriaEvaluator:
    """Calculates weighted multi-factor scores for candidate vendors and recovery options."""

    @staticmethod
    def score_scout_candidate(
        candidate: CandidateVendor,
        max_budget: float,
        best_price: float = 300000.0
    ) -> Tuple[float, Dict[str, float]]:
        """
        Scout weights:
        - suitability: 30%
        - availability: 20%
        - reliability: 20%
        - price: 15%
        - delivery: 10%
        - insurance: 5%
        """
        # Suitability (0-100 -> 30)
        suitability_pts = (candidate.suitability_score / 100.0) * 30.0

        # Availability (20)
        avail_pts = 20.0 if candidate.available else 0.0

        # Reliability (0-100 -> 20)
        rel_pts = (candidate.reliability_score / 100.0) * 20.0

        # Price competitiveness (15): relative to budget & best price
        if max_budget > 0:
            price_ratio = max(0.0, 1.0 - (candidate.price / max_budget))
            price_pts = min(15.0, price_ratio * 15.0 + 5.0)
        else:
            price_pts = 10.0

        # Delivery speed (10): 0 days = 10, 1 day = 8, 2 days = 5, >2 days = 0
        if candidate.delivery_days == 0:
            del_pts = 10.0
        elif candidate.delivery_days == 1:
            del_pts = 8.0
        elif candidate.delivery_days == 2:
            del_pts = 5.0
        else:
            del_pts = 0.0

        # Insurance (5): 5 if included else 0
        ins_pts = 5.0 if candidate.insurance_included else 0.0

        total_score = round(suitability_pts + avail_pts + rel_pts + price_pts + del_pts + ins_pts, 1)

        breakdown = {
            "suitability": round(suitability_pts, 1),
            "availability": round(avail_pts, 1),
            "reliability": round(rel_pts, 1),
            "price": round(price_pts, 1),
            "delivery": round(del_pts, 1),
            "insurance": round(ins_pts, 1)
        }

        return total_score, breakdown

    @staticmethod
    def score_recovery_option(
        candidate: CandidateVendor,
        original_price: float,
        compatibility_score: float,
        schedule_delay_days: int
    ) -> RecoveryOption:
        """
        Recovery weights:
        - compatibility: 30%
        - availability: 20%
        - schedule impact: 20%
        - cost impact: 15%
        - reliability: 10%
        - insurance: 5%
        """
        # Compatibility (30)
        compat_pts = (compatibility_score / 100.0) * 30.0

        # Availability (20)
        avail_pts = 20.0 if candidate.available else 0.0

        # Schedule impact (20): 0 delay = 20 pts, 1 day = 10 pts, >1 day = 0
        if schedule_delay_days == 0:
            sched_pts = 20.0
        elif schedule_delay_days == 1:
            sched_pts = 10.0
        else:
            sched_pts = 0.0

        # Cost impact (15): delta vs original
        cost_delta = candidate.price - original_price
        if cost_delta <= 0:
            cost_pts = 15.0
        elif cost_delta <= 10000:
            cost_pts = 13.0
        elif cost_delta <= 50000:
            cost_pts = 9.0
        else:
            cost_pts = 4.0

        # Reliability (10)
        rel_pts = (candidate.reliability_score / 100.0) * 10.0

        # Insurance (5)
        ins_pts = 5.0 if candidate.insurance_included else 0.0

        total_score = round(compat_pts + avail_pts + sched_pts + cost_pts + rel_pts + ins_pts, 1)

        reasons = []
        risks = []

        if candidate.specifications.get("low_light", False):
            reasons.append("Low-light compatible")
        if candidate.delivery_days == 0:
            reasons.append("Available today")
        if candidate.distance_km > 0:
            reasons.append(f"{candidate.distance_km:.0f} km from location")
        if candidate.insurance_included:
            reasons.append("Insurance included")

        if cost_delta > 0:
            risks.append(f"+₹{cost_delta:,.0f} cost delta over original line")
        if schedule_delay_days > 0:
            risks.append(f"{schedule_delay_days} day production schedule delay")
        if not candidate.available:
            risks.append("Candidate currently unavailable")

        return RecoveryOption(
            candidate=candidate,
            compatibility_score=round(compat_pts, 1),
            availability_score=round(avail_pts, 1),
            schedule_score=round(sched_pts, 1),
            cost_score=round(cost_pts, 1),
            reliability_score=round(rel_pts, 1),
            insurance_score=round(ins_pts, 1),
            total_score=total_score,
            cost_delta=cost_delta,
            schedule_delay_days=schedule_delay_days,
            reasons=reasons,
            risks=risks
        )
