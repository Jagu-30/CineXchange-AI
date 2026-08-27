import pytest
from backend.app.agents.recovery.agent import EmergencyRecoveryAgent
from backend.app.agents.common.schemas import Incident

def test_emergency_recovery_ranking_and_explanation():
    agent = EmergencyRecoveryAgent()
    incident = Incident(
        incident_id="INC-001",
        event="RESOURCE_UNAVAILABLE",
        resource_id="CAM-001",
        severity="HIGH",
        details={"message": "Sensor error on ARRI Alexa Mini LF"}
    )

    plan, audit = agent.calculate_recovery_options(
        incident=incident,
        original_price=480000.0,
        target_specs={"low_light": True, "weather_sealed": True, "scenes": 2}
    )

    assert plan.incident_id == "INC-001"
    assert len(plan.options) >= 2
    assert plan.selected_option == "CAM-002"
    assert plan.impact.schedule_risk == "LOW"

    # Best option should be CAM-002 with 0 schedule delay and +8000 cost delta
    top_opt = plan.options[0]
    assert top_opt.candidate.resource_id == "CAM-002"
    assert top_opt.schedule_delay_days == 0
    assert top_opt.cost_delta == 8000.0
    assert top_opt.total_score >= 88.0

    # Explanation must mention trade-off / zero schedule delay
    assert "8,000" in plan.explanation or "8000" in plan.explanation or "CAM-002" in plan.explanation
    assert "delay" in plan.explanation.lower() or "today" in plan.explanation.lower()

    assert audit.status == "approval_required"
    assert "CAM-002" in audit.output_summary
