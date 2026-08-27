from typing import Any, Dict, List, Tuple
from backend.app.config import settings
from backend.app.agents.common.schemas import (
    CandidateVendor,
    ComplianceDocument,
    Quote,
    RiskBreakdown,
    ApprovalDecision
)

class PolicyEngine:
    """Deterministic policy rules enforcing compliance, budget, and quality bounds."""

    @staticmethod
    def check_quality(quality_score: float, min_quality: float = None) -> Tuple[bool, str]:
        threshold = min_quality if min_quality is not None else settings.MIN_ACCEPTABLE_QUALITY
        if quality_score < threshold:
            return False, f"Quality score {quality_score:.1f} is below mandatory threshold of {threshold:.1f}"
        return True, f"Quality score {quality_score:.1f} meets requirement"

    @staticmethod
    def check_insurance(insurance_included: bool, insurance_required: bool = True) -> Tuple[bool, str]:
        if insurance_required and not insurance_included:
            return False, "Mandatory on-site equipment/crew insurance is not included"
        return True, "Mandatory insurance verified"

    @staticmethod
    def check_delivery(delivery_days: int, max_days: int = 2) -> Tuple[bool, str]:
        if delivery_days > max_days:
            return False, f"Delivery lead time {delivery_days} days exceeds maximum allowable {max_days} days"
        return True, f"Delivery lead time {delivery_days} days within window"

    @staticmethod
    def check_budget_limit(price: float, budget_remaining: float) -> Tuple[bool, str]:
        if price > budget_remaining:
            return False, f"Price ₹{price:,.0f} exceeds remaining budget ₹{budget_remaining:,.0f}"
        return True, f"Price ₹{price:,.0f} within budget envelope"

    @staticmethod
    def check_hard_filters(
        candidate: CandidateVendor,
        budget_remaining: float,
        require_low_light: bool = True
    ) -> Tuple[bool, List[str], List[str]]:
        """Applies all hard deterministic filters to a candidate vendor."""
        passed = True
        reasons: List[str] = []
        rejected_reasons: List[str] = []

        if not candidate.available:
            passed = False
            rejected_reasons.append("Resource is not available for requested dates")
        else:
            reasons.append("Available for shoot dates")

        b_ok, b_msg = PolicyEngine.check_budget_limit(candidate.price, budget_remaining)
        if not b_ok:
            passed = False
            rejected_reasons.append(b_msg)
        else:
            reasons.append("Within budget limit")

        q_ok, q_msg = PolicyEngine.check_quality(candidate.quality_score)
        if not q_ok:
            passed = False
            rejected_reasons.append(q_msg)
        else:
            reasons.append("Meets quality standards (>= 85)")

        ins_ok, ins_msg = PolicyEngine.check_insurance(candidate.insurance_included, candidate.insurance_required)
        if not ins_ok:
            passed = False
            rejected_reasons.append(ins_msg)
        else:
            reasons.append("Mandatory insurance included")

        del_ok, del_msg = PolicyEngine.check_delivery(candidate.delivery_days)
        if not del_ok:
            passed = False
            rejected_reasons.append(del_msg)
        else:
            reasons.append("Delivery within timeframe")

        if require_low_light and candidate.resource_type == "CAMERA":
            is_low_light = candidate.specifications.get("low_light", False)
            if not is_low_light:
                passed = False
                rejected_reasons.append("Lacks mandatory low-light / dual-ISO capability for rainforest night shoot")
            else:
                reasons.append("Low-light compatible")

        return passed, reasons, rejected_reasons

    @staticmethod
    def evaluate_negotiation_counter(
        current_price: float,
        counter_price: float,
        round_number: int,
        max_rounds: int,
        insurance_included: bool,
        quality_score: float
    ) -> Tuple[bool, str, float]:
        """Evaluates whether a negotiated package or counter offer meets policy."""
        if round_number > max_rounds:
            return False, f"Maximum negotiation rounds ({max_rounds}) reached", 0.0

        if not insurance_included:
            return False, "Cannot accept counter-offer: Mandatory insurance removed or missing", 0.0

        if quality_score < settings.MIN_ACCEPTABLE_QUALITY:
            return False, f"Quality {quality_score} below minimum acceptable {settings.MIN_ACCEPTABLE_QUALITY}", 0.0

        savings_percent = ((current_price - counter_price) / current_price) * 100.0 if current_price > 0 else 0.0
        return True, "Valid counter offer evaluated", savings_percent

    @staticmethod
    def evaluate_compliance_risk(
        documents: List[ComplianceDocument],
        deal_amount: float,
        required_coverage: float = 2500000.0
    ) -> Tuple[RiskBreakdown, ApprovalDecision]:
        """Calculates 5-dimensional risk matrix and deterministic approval requirements."""
        vendor_risk = 0
        contract_risk = 0
        insurance_risk = 0
        permit_risk = 0
        financial_risk = 0

        reasons: List[str] = []
        blocking_reasons: List[str] = []
        approval_reasons: List[str] = []

        doc_types = {d.document_type: d for d in documents}

        # 1. Insurance Check
        ins_doc = doc_types.get("INSURANCE")
        if not ins_doc or ins_doc.status == "MISSING":
            insurance_risk = 5
            blocking_reasons.append("Mandatory on-site insurance document is missing")
        elif ins_doc.status == "EXPIRED":
            insurance_risk = 5
            blocking_reasons.append(f"Insurance policy {ins_doc.document_id} has expired")
        elif ins_doc.coverage_amount < required_coverage:
            insurance_risk = 4
            blocking_reasons.append(
                f"Insurance coverage ₹{ins_doc.coverage_amount:,.0f} is less than required ₹{required_coverage:,.0f}"
            )
        else:
            insurance_risk = 0
            reasons.append("Comprehensive insurance policy verified and active")

        # 2. Permit Check
        permit_doc = doc_types.get("PERMIT")
        if not permit_doc or permit_doc.status == "MISSING":
            permit_risk = 5
            blocking_reasons.append("Mandatory Forest Department night filming permit is missing")
        elif permit_doc.status != "VALID":
            permit_risk = 4
            blocking_reasons.append("Forest Department filming permit is pending or invalid")
        else:
            permit_risk = 0
            reasons.append("Forest Department clearance confirmed for Agumbe eco-zone")

        # 3. Contract Check
        contract_doc = doc_types.get("CONTRACT")
        if not contract_doc or contract_doc.status != "VALID":
            contract_risk = 3
            approval_reasons.append("Standard service contract requires producer counter-signature")
        else:
            contract_risk = 1
            reasons.append("Master equipment rental agreement verified")

        # 4. Financial Risk & High Value Threshold
        if deal_amount >= settings.HIGH_VALUE_APPROVAL_THRESHOLD:
            financial_risk = 2
            approval_reasons.append(
                f"Deal value (₹{deal_amount:,.0f}) exceeds producer auto-approval threshold (₹{settings.HIGH_VALUE_APPROVAL_THRESHOLD:,.0f})"
            )
        else:
            financial_risk = 1
            reasons.append(f"Deal value within auto-approval limits (< ₹{settings.HIGH_VALUE_APPROVAL_THRESHOLD:,.0f})")

        # 5. Vendor Risk
        vendor_risk = 1

        # Overall level calculation
        max_risk = max(vendor_risk, contract_risk, insurance_risk, permit_risk, financial_risk)
        if len(blocking_reasons) > 0:
            overall_level = "BLOCKED"
        elif max_risk >= 3:
            overall_level = "HIGH"
        elif max_risk >= 2:
            overall_level = "MEDIUM"
        else:
            overall_level = "LOW"

        risk_breakdown = RiskBreakdown(
            vendor_risk=vendor_risk,
            contract_risk=contract_risk,
            insurance_risk=insurance_risk,
            permit_risk=permit_risk,
            financial_risk=financial_risk,
            overall_level=overall_level,
            reasons=reasons + approval_reasons + blocking_reasons
        )

        requires_producer = overall_level in ["MEDIUM", "HIGH", "BLOCKED"] or deal_amount >= settings.HIGH_VALUE_APPROVAL_THRESHOLD
        status = "BLOCKED" if overall_level == "BLOCKED" else ("PENDING_PRODUCER_APPROVAL" if requires_producer else "AUTO_APPROVED")

        next_action = "Resolve blocking compliance deficiencies" if overall_level == "BLOCKED" else (
            "Request producer approval" if requires_producer else "Proceed to automated booking"
        )

        approval = ApprovalDecision(
            approval_id=f"APPR-{int(deal_amount)}",
            status=status,
            requires_producer_approval=requires_producer,
            blocking_reasons=blocking_reasons,
            approval_reasons=approval_reasons if approval_reasons else ["All policy criteria verified"],
            next_action=next_action,
            risk=risk_breakdown
        )

        return risk_breakdown, approval
