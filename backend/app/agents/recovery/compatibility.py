from typing import Dict, Any, Tuple
from backend.app.agents.common.schemas import CandidateVendor

class TechnicalCompatibilityScorer:
    """Evaluates technical compatibility between failed equipment and replacement candidates."""

    @staticmethod
    def score_camera_compatibility(
        target_specs: Dict[str, Any],
        candidate: CandidateVendor
    ) -> Tuple[float, list[str]]:
        score = 100.0
        reasons = []
        cand_specs = candidate.specifications

        # 1. Low light requirement
        if target_specs.get("low_light", True):
            if cand_specs.get("low_light", False):
                reasons.append("Matches low-light sensitivity requirements")
            else:
                score -= 40.0
                reasons.append("Lacks required low-light / dual ISO capability")

        # 2. Weather sealing
        if target_specs.get("weather_sealed", True):
            if cand_specs.get("weather_sealed", False):
                reasons.append("Weather-sealed body for rainforest moisture")
            else:
                score -= 20.0
                reasons.append("Missing environmental weather sealing")

        # 3. Quality score factor
        if candidate.quality_score < 85.0:
            score -= 25.0
            reasons.append(f"Quality score ({candidate.quality_score}) below cinema standard")

        final_score = max(0.0, min(100.0, score))
        return final_score, reasons
