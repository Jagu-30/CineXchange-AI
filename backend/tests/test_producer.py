import pytest
from backend.app.agents.producer.agent import ProducerAgent
from backend.app.agents.producer.validator import ProducerValidator
from backend.app.agents.common.schemas import ProjectInput, Requirement

def test_producer_requirement_extraction():
    agent = ProducerAgent()
    project = ProjectInput(
        project_id="PROJ-001",
        title="Rainforest Night Shoot",
        producer_request="We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.",
        budget=2500000.0,
        currency="INR",
        duration_days=3,
        location="Western Ghats rainforest"
    )

    result, audit = agent.run(project)
    assert len(result.requirements) >= 5
    assert audit.status == "successful"
    assert audit.agent == "producer"

    # Check low-light camera requirement
    camera_req = next((r for r in result.requirements if r.resource_type == "CAMERA"), None)
    assert camera_req is not None
    assert camera_req.specifications.get("low_light") is True
    assert camera_req.duration_days == 3
    assert camera_req.mandatory is True

    # Check compliance items extracted
    ins_req = next((r for r in result.requirements if r.resource_type == "INSURANCE"), None)
    prm_req = next((r for r in result.requirements if r.resource_type == "PERMIT"), None)
    assert ins_req is not None
    assert prm_req is not None

def test_producer_validator_errors():
    import pydantic
    # Test Pydantic gt=0 constraint on duration_days
    with pytest.raises(pydantic.ValidationError):
        ProjectInput(
            project_id="PROJ-ERR",
            producer_request="Short",
            budget=10000.0,
            duration_days=0,
            location="Somewhere"
        )

    # Test ProducerValidator logic error on empty brief or zero budget
    proj = ProjectInput(
        project_id="PROJ-ERR",
        producer_request="Hi",
        budget=0.0,
        duration_days=1,
        location="Somewhere"
    )
    valid, errors = ProducerValidator.validate_project_input(proj)
    assert not valid
    assert len(errors) >= 1

def test_producer_missing_camera_validation():
    reqs = [
        Requirement(
            requirement_id="REQ-01",
            category="EQUIPMENT",
            resource="Light tube",
            resource_type="LIGHTING",
            quantity=1,
            duration_days=3,
            specifications={},
            priority="HIGH",
            mandatory=True
        )
    ]
    valid, errors = ProducerValidator.validate_requirements(reqs, 3)
    assert not valid
    assert any("camera" in e.lower() for e in errors)
