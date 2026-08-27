import pytest
from backend.app.agents.compliance.agent import ComplianceApprovalAgent
from backend.app.agents.common.schemas import ComplianceDocument

def test_compliance_valid_documents_high_value_flow():
    agent = ComplianceApprovalAgent()
    # High value deal (>= ₹10,00,000) should require Producer Approval
    res, audit = agent.check_compliance(vendor_id="V003", deal_amount=1449000.0)

    assert res.all_mandatory_valid is True
    assert res.approval.requires_producer_approval is True
    assert res.approval.status == "PENDING_PRODUCER_APPROVAL"
    assert res.risk.overall_level in ["MEDIUM", "LOW"]
    assert audit.status == "approval_required"

    # Producer approvals flow
    decision, dec_audit = agent.record_decision(
        approval_id=res.approval.approval_id,
        approved=True,
        notes="Producer reviewed and approved"
    )
    assert decision.status == "APPROVED"
    assert dec_audit.status == "successful"

def test_compliance_blocking_expired_insurance():
    agent = ComplianceApprovalAgent()
    expired_doc = ComplianceDocument(
        document_id="DOC-TEST-EXPIRED",
        document_type="INSURANCE",
        vendor_id="V005",
        vendor_name="CheapGear",
        valid_from="2024-01-01",
        valid_until="2024-12-31",
        coverage_amount=500000.0,
        status="EXPIRED",
        extraction_confidence=0.99
    )

    res, audit = agent.check_compliance(
        vendor_id="V005",
        deal_amount=300000.0,
        custom_docs=[expired_doc]
    )

    assert res.approval.status == "BLOCKED"
    assert res.risk.overall_level == "BLOCKED"
    assert len(res.approval.blocking_reasons) > 0
    assert any("expired" in r.lower() for r in res.approval.blocking_reasons)
    assert audit.status == "blocked"

def test_compliance_insufficient_coverage():
    agent = ComplianceApprovalAgent()
    insufficient_doc = ComplianceDocument(
        document_id="DOC-LOW-COVER",
        document_type="INSURANCE",
        vendor_id="V005",
        vendor_name="CheapGear",
        valid_from="2026-08-01",
        valid_until="2026-08-30",
        coverage_amount=200000.0,  # Below required 25L
        status="VALID",
        extraction_confidence=0.99
    )

    res, _ = agent.check_compliance(
        vendor_id="V005",
        deal_amount=500000.0,
        custom_docs=[insufficient_doc]
    )

    assert len(res.approval.blocking_reasons) > 0
    assert any("less than required" in r.lower() for r in res.approval.blocking_reasons)
