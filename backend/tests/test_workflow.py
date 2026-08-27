import pytest
from backend.app.orchestration.workflow import ProductionWorkflow
from backend.app.agents.common.schemas import ProjectInput, WorkflowState, Incident
from backend.app.agents.common.exceptions import InvalidStateTransitionError

def test_full_production_workflow_happy_path():
    wf = ProductionWorkflow()
    project = ProjectInput(
        project_id="PROJ-TEST-001",
        title="Rainforest Night Shoot",
        producer_request="We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.",
        budget=2500000.0,
        currency="INR",
        duration_days=3,
        location="Western Ghats rainforest"
    )

    # 1. Plan project (Producer)
    state = wf.plan_project(project)
    assert state.current_state == WorkflowState.REQUIREMENTS_EXTRACTED
    assert len(state.requirements) >= 5

    # 2. Scout Marketplace (Scout)
    state = wf.run_scout("PROJ-TEST-001")
    assert state.current_state == WorkflowState.CANDIDATES_READY
    assert len(state.candidates) >= 1

    # 3. Start & Accept Negotiation (Negotiation)
    state = wf.start_negotiation("PROJ-TEST-001", "V003", "CAM-002")
    neg_id = state.negotiations[0].negotiation_id
    state = wf.counter_negotiation("PROJ-TEST-001", neg_id, counter_price=441600.0)
    state = wf.accept_negotiation("PROJ-TEST-001", neg_id)
    assert state.current_state == WorkflowState.QUOTE_READY

    # 4. Compliance Verification (Compliance)
    state = wf.run_compliance("PROJ-TEST-001", "V003")
    assert state.current_state in [WorkflowState.APPROVAL_REQUIRED, WorkflowState.APPROVED]

    # 5. Producer Approval -> Booking
    approval_id = state.approvals[0].approval_id
    state = wf.record_approval("PROJ-TEST-001", approval_id, approved=True)
    assert state.current_state == WorkflowState.BOOKED
    assert len(state.bookings) >= 1

    # 6. Emergency Incident Trigger (Recovery)
    inc = Incident(
        incident_id="INC-001",
        event="RESOURCE_UNAVAILABLE",
        resource_id="CAM-001",
        severity="HIGH",
        details={"message": "Sensor error mid-shoot"}
    )
    state = wf.trigger_incident("PROJ-TEST-001", inc)
    assert state.current_state == WorkflowState.INCIDENT_DETECTED

    # 7. Run Recovery
    state = wf.run_recovery("PROJ-TEST-001", "INC-001")
    assert state.current_state == WorkflowState.RECOVERY_APPROVAL_REQUIRED
    assert len(state.recovery_options) >= 1

    # 8. Approve Recovery
    state = wf.approve_recovery("PROJ-TEST-001", "CAM-002")
    assert state.current_state in [WorkflowState.RECOVERY_APPROVED, WorkflowState.BOOKED]
    assert state.bookings[0].resource_id == "CAM-002"

    # Audit log check
    assert len(state.audit_log) >= 7
