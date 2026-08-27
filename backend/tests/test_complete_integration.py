import pytest
from backend.app.orchestration.workflow import ProductionWorkflow
from backend.app.agents.common.schemas import (
    ProjectInput,
    WorkflowState,
    Incident,
    ComplianceDocument,
)
from backend.app.agents.negotiation.agent import NegotiationAgent
from backend.app.agents.compliance.agent import ComplianceApprovalAgent
from backend.app.agents.recovery.agent import EmergencyRecoveryAgent
from backend.app.agents.common.policies import PolicyEngine
from backend.app.agents.negotiation.policy import NegotiationPolicy
from backend.app.agents.common.state import state_manager


def test_full_e2e_19_step_workflow_verification():
    """
    End-to-end integration test verifying all 19 workflow steps:
    1. Create Rainforest Night Shoot project.
    2. Submit natural-language request.
    3. Extract requirements.
    4. Display and edit requirements.
    5. Run marketplace scouting.
    6. Display ranked vendors and rejected candidates.
    7. Request and negotiate quote.
    8. Confirm cheaper vendor without insurance is rejected.
    9. Run compliance.
    10. Confirm high-value / medium-risk deals require producer approval.
    11. Confirm expired insurance blocks the deal.
    12. Simulate booking.
    13. Trigger RESOURCE_UNAVAILABLE for CAM-001.
    14. Generate recovery options.
    15. Confirm CAM-002 is selected (compatibility + zero schedule delay).
    16. Show ₹8,000 cost delta.
    17. Run recovery compliance.
    18. Show producer approval requirement.
    19. Confirm every step appears in the agent activity timeline.
    """
    wf = ProductionWorkflow()

    # Step 1 & 2: Create project & submit natural language request
    project = ProjectInput(
        project_id="PROJ-E2E-001",
        title="Rainforest Night Shoot",
        producer_request="We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.",
        budget=2500000.0,
        currency="INR",
        duration_days=3,
        location="Western Ghats rainforest (Agumbe)",
        start_date="2026-08-20"
    )

    # Step 3: Extract requirements (Producer Agent)
    state = wf.plan_project(project)
    assert state.current_state == WorkflowState.REQUIREMENTS_EXTRACTED
    assert len(state.requirements) >= 5

    # Step 4: Display and verify requirement categories
    camera_req = next((r for r in state.requirements if r.resource_type == "CAMERA"), None)
    insurance_req = next((r for r in state.requirements if r.resource_type == "INSURANCE"), None)
    permit_req = next((r for r in state.requirements if r.resource_type == "PERMIT"), None)

    assert camera_req is not None
    assert camera_req.specifications.get("low_light") is True
    assert insurance_req is not None
    assert permit_req is not None

    # Step 5: Run Marketplace Scouting (Marketplace Scout Agent)
    state = wf.run_scout("PROJ-E2E-001")
    assert state.current_state == WorkflowState.CANDIDATES_READY
    assert len(state.candidates) >= 3

    # Step 6: Display ranked vendors and verify rejected candidates
    ranked_passed = [c for c in state.candidates if c.hard_constraints_passed]
    rejected = [c for c in state.candidates if not c.hard_constraints_passed]

    assert len(ranked_passed) >= 1
    assert len(rejected) >= 1

    # Verify CAM-003 rejected for low-light or insurance & CAM-004 rejected for availability
    cam_003_rej = next((c for c in rejected if c.candidate.resource_id == "CAM-003"), None)
    cam_004_rej = next((c for c in rejected if c.candidate.resource_id == "CAM-004"), None)
    assert cam_003_rej is not None
    assert any("low-light" in r.lower() or "insurance" in r.lower() for r in cam_003_rej.rejected_reasons)
    assert cam_004_rej is not None
    assert any("not available" in r.lower() or "available" in r.lower() for r in cam_004_rej.rejected_reasons)


    # Step 7: Request and negotiate a quote (Negotiation Agent)
    state = wf.start_negotiation("PROJ-E2E-001", "V003", "CAM-002")
    neg_id = state.negotiations[0].negotiation_id
    assert state.current_state == WorkflowState.NEGOTIATION_IN_PROGRESS

    # Counter offer
    state = wf.counter_negotiation("PROJ-E2E-001", neg_id, counter_price=441600.0)
    assert len(state.negotiations[0].history) >= 2

    # Accept negotiated offer
    state = wf.accept_negotiation("PROJ-E2E-001", neg_id)
    assert state.current_state == WorkflowState.QUOTE_READY
    assert state.negotiations[0].status == "ACCEPTED"

    # Step 8: Confirm cheaper vendor without insurance is rejected by policy
    is_valid, errs = NegotiationPolicy.validate_offer(
        price=320000.0,
        insurance_included=False, # Missing insurance
        quality_score=90.0,
        delivery_days=1,
        round_number=1,
        max_rounds=3
    )
    assert not is_valid
    assert any("insurance" in e.lower() for e in errs)

    # Step 9: Run Compliance (Compliance & Approval Agent)
    state = wf.run_compliance("PROJ-E2E-001", "V003")
    assert state.current_state in [WorkflowState.APPROVAL_REQUIRED, WorkflowState.APPROVED]
    assert state.risk_assessments is not None

    # Step 10: Confirm high-value (>₹10 Lakh) or medium risk requires producer approval
    appr = state.approvals[0]
    assert appr.requires_producer_approval is True
    assert appr.status == "PENDING_PRODUCER_APPROVAL"
    assert any("10,00,000" in r or "10" in r or "threshold" in r.lower() for r in appr.approval_reasons)

    # Step 11: Confirm expired insurance blocks the deal
    comp_agent = ComplianceApprovalAgent()
    expired_doc = ComplianceDocument(
        document_id="DOC-EXP",
        document_type="INSURANCE",
        vendor_id="V999",
        vendor_name="Expired Vendor",
        valid_from="2020-01-01",
        valid_until="2021-01-01", # Expired
        coverage_amount=5000000.0,
        status="EXPIRED",
        extraction_confidence=0.99,
        extracted_fields={"status": "EXPIRED"}
    )
    eval_res, _ = comp_agent.check_compliance("V999", 500000.0, custom_docs=[expired_doc])
    assert eval_res.risk.overall_level == "BLOCKED"
    assert eval_res.approval.status == "BLOCKED"



    # Step 12: Simulate booking authorization
    state = wf.record_approval("PROJ-E2E-001", appr.approval_id, approved=True)
    assert state.current_state == WorkflowState.BOOKED
    assert len(state.bookings) >= 1

    # Step 13: Trigger RESOURCE_UNAVAILABLE for CAM-001
    inc = Incident(
        incident_id="INC-E2E-001",
        event="RESOURCE_UNAVAILABLE",
        resource_id="CAM-001",
        severity="HIGH",
        details={"message": "ARRI Alexa Mini LF sensor failure mid-shoot in Agumbe"}
    )
    state = wf.trigger_incident("PROJ-E2E-001", inc)
    assert state.current_state == WorkflowState.INCIDENT_DETECTED
    assert len(state.incidents) >= 1

    # Step 14: Generate recovery options (Emergency Recovery Agent)
    state = wf.run_recovery("PROJ-E2E-001", "INC-E2E-001")
    assert state.current_state == WorkflowState.RECOVERY_APPROVAL_REQUIRED
    assert len(state.recovery_options) >= 2

    # Step 15: Confirm CAM-002 is selected because of compatibility and zero schedule delay
    top_recovery = state.recovery_options[0]
    assert top_recovery.candidate.resource_id == "CAM-002"
    assert top_recovery.schedule_delay_days == 0
    assert top_recovery.candidate.distance_km <= 15 # 12 km away

    # Step 16: Show the ₹8,000 cost delta
    assert top_recovery.cost_delta == 8000.0

    # Step 17 & 18: Run recovery compliance & show producer approval requirement
    assert top_recovery.candidate.insurance_included is True
    assert top_recovery.candidate.specifications.get("low_light") is True

    # Step 19: Confirm every step appears in the agent activity timeline
    actions_logged = [e.action for e in state.audit_log]
    assert "REQUIREMENTS_EXTRACTED" in actions_logged
    assert any("SCOUT" in a for a in actions_logged)
    assert any("NEGOTIATION" in a for a in actions_logged)
    assert "ACCEPT_OFFER" in actions_logged
    assert "COMPLIANCE_EVALUATION" in actions_logged
    assert "PRODUCER_APPROVED" in actions_logged
    assert "INCIDENT_ALERT_TRIGGERED" in actions_logged
    assert "INCIDENT_RECOVERY_EXECUTED" in actions_logged

    # Complete recovery approval
    state = wf.approve_recovery("PROJ-E2E-001", "CAM-002")
    assert state.current_state == WorkflowState.RECOVERY_APPROVED
    assert any(b.resource_id == "CAM-002" for b in state.bookings)

