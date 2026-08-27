from typing import List, Tuple
from backend.app.agents.common.schemas import ComplianceDocument
from backend.app.config import settings

class CompliancePolicy:
    """Enforces legal, regulatory, and financial compliance policies."""

    @staticmethod
    def check_blocking_conditions(documents: List[ComplianceDocument]) -> Tuple[bool, List[str]]:
        blockers = []
        doc_types = {d.document_type: d for d in documents}

        if "INSURANCE" not in doc_types:
            blockers.append("Missing mandatory insurance document")
        elif doc_types["INSURANCE"].status == "EXPIRED":
            blockers.append("Insurance policy is expired")
        elif doc_types["INSURANCE"].coverage_amount < 1000000.0:
            blockers.append("Insurance coverage is insufficient (< ₹10 Lakh)")

        if "PERMIT" not in doc_types:
            blockers.append("Missing mandatory forest filming permit")
        elif doc_types["PERMIT"].status != "VALID":
            blockers.append("Forest filming permit is invalid or unconfirmed")

        return len(blockers) > 0, blockers
