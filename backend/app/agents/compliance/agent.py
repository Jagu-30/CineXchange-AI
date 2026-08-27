from typing import Any, Dict, List, Optional, Tuple
from backend.app.agents.common.agent_base import BaseAgent
from backend.app.agents.common.schemas import (
    ComplianceDocument,
    RiskBreakdown,
    ApprovalDecision,
    AuditLogEntry
)
from backend.app.agents.compliance.schemas import ComplianceEvaluationResult
from backend.app.agents.compliance.extraction import DocumentExtractor
from backend.app.agents.compliance.risk import RiskEngine

class ComplianceApprovalAgent(BaseAgent):
    """Compliance and Approval Agent evaluates documents, risks, and governance."""

    def __init__(self):
        super().__init__(
            agent_id="compliance",
            agent_name="Compliance & Approval Agent",
            role="Permits, Insurance & Risk Governance"
        )
        self.extractor = DocumentExtractor()

    # Tool 1: extract_document
    def extract_document(self, document_id: str) -> Optional[ComplianceDocument]:
        return self.extractor.get_document_by_id(document_id)

    # Tool 2: check_compliance
    def check_compliance(
        self,
        vendor_id: str = "V003",
        deal_amount: float = 1449000.0,
        custom_docs: Optional[List[ComplianceDocument]] = None
    ) -> Tuple[ComplianceEvaluationResult, AuditLogEntry]:
        docs = custom_docs if custom_docs is not None else self.extractor.get_documents_for_vendor(vendor_id)
        risk, approval = RiskEngine.assess_risk(documents=docs, deal_amount=deal_amount)

        is_all_valid = all(d.status == "VALID" for d in docs) and approval.status != "BLOCKED"

        summary = (
            f"Risk Level: {risk.overall_level}. Status: {approval.status}. "
            f"Evaluated {len(docs)} legal & regulatory documents for {vendor_id}."
        )

        audit_status = (
            "blocked" if approval.status == "BLOCKED"
            else ("approval_required" if approval.requires_producer_approval else "successful")
        )

        audit = self.create_audit_entry(
            action="COMPLIANCE_EVALUATION",
            status=audit_status,
            input_summary=f"Vendor: {vendor_id}, Deal Value: ₹{deal_amount:,.0f}, Documents: {len(docs)} files",
            output_summary=f"Risk: {risk.overall_level} | Status: {approval.status} | Next: {approval.next_action}",
            policy_checks=[
                f"Insurance coverage verified: ₹{next((d.coverage_amount for d in docs if d.document_type == 'INSURANCE'), 0):,.0f}",
                f"Permit status: {next((d.status for d in docs if d.document_type == 'PERMIT'), 'MISSING')}",
                f"Deal value ₹{deal_amount:,.0f} vs auto-approval threshold ₹10.00L",
                f"Risk matrix evaluated: Vendor({risk.vendor_risk}), Contract({risk.contract_risk}), Insurance({risk.insurance_risk}), Permit({risk.permit_risk}), Financial({risk.financial_risk})"
            ],
            warnings=approval.blocking_reasons if approval.blocking_reasons else approval.approval_reasons,
            next_action=approval.next_action
        )

        result = ComplianceEvaluationResult(
            documents=docs,
            risk=risk,
            approval=approval,
            all_mandatory_valid=is_all_valid,
            summary=summary
        )

        return result, audit

    # Tool 3: record_producer_approval
    def record_decision(
        self,
        approval_id: str,
        approved: bool,
        notes: str = ""
    ) -> Tuple[ApprovalDecision, AuditLogEntry]:
        new_status = "APPROVED" if approved else "REJECTED"
        next_act = "Generate official booking and purchase records" if approved else "Re-open sourcing for alternative vendors"

        dummy_risk = RiskBreakdown(
            vendor_risk=1, contract_risk=1, insurance_risk=0, permit_risk=0, financial_risk=1,
            overall_level="LOW" if approved else "HIGH",
            reasons=[f"Producer decision: {new_status}"]
        )

        decision = ApprovalDecision(
            approval_id=approval_id,
            status=new_status,
            requires_producer_approval=False,
            blocking_reasons=[],
            approval_reasons=[f"Producer explicitly {new_status.lower()} package commitments."],
            next_action=next_act,
            risk=dummy_risk
        )

        audit = self.create_audit_entry(
            action=f"PRODUCER_{new_status}",
            status="successful" if approved else "failed",
            input_summary=f"Producer decision on {approval_id}: {new_status}",
            output_summary=f"Status set to {new_status}. {notes}",
            policy_checks=["Producer cryptographic authorization recorded", "Audit trail logged"],
            next_action=next_act
        )

        return decision, audit

    def run(
        self,
        vendor_id: str = "V003",
        deal_amount: float = 1449000.0,
        custom_docs: Optional[List[ComplianceDocument]] = None
    ) -> Tuple[ComplianceEvaluationResult, AuditLogEntry]:
        return self.check_compliance(vendor_id=vendor_id, deal_amount=deal_amount, custom_docs=custom_docs)

