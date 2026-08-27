from typing import List, Tuple
from backend.app.agents.common.schemas import ComplianceDocument, RiskBreakdown, ApprovalDecision
from backend.app.agents.common.policies import PolicyEngine

class RiskEngine:
    """Calculates risk assessments and evaluates approval requirements."""

    @staticmethod
    def assess_risk(
        documents: List[ComplianceDocument],
        deal_amount: float,
        required_coverage: float = 2500000.0
    ) -> Tuple[RiskBreakdown, ApprovalDecision]:
        return PolicyEngine.evaluate_compliance_risk(
            documents=documents,
            deal_amount=deal_amount,
            required_coverage=required_coverage
        )
