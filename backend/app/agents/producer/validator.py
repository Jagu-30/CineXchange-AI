from typing import List, Tuple
from backend.app.agents.common.schemas import ProjectInput, Requirement
from backend.app.agents.common.exceptions import ValidationError

class ProducerValidator:
    """Validates producer project input and extracted requirements."""

    @staticmethod
    def validate_project_input(project: ProjectInput) -> Tuple[bool, List[str]]:
        errors = []
        if not project.producer_request or len(project.producer_request.strip()) < 5:
            errors.append("Producer request must contain meaningful shoot details.")
        if project.budget <= 0:
            errors.append("Budget must be greater than zero.")
        if project.duration_days <= 0:
            errors.append("Duration days must be at least 1.")
        return len(errors) == 0, errors

    @staticmethod
    def validate_requirements(requirements: List[Requirement], duration_days: int) -> Tuple[bool, List[str]]:
        errors = []
        if not requirements:
            errors.append("At least one requirement must be specified.")

        has_camera = False
        has_insurance = False
        has_permit = False

        for r in requirements:
            if r.quantity <= 0:
                errors.append(f"Requirement {r.requirement_id}: quantity must be > 0")
            if r.duration_days <= 0:
                errors.append(f"Requirement {r.requirement_id}: duration_days must be > 0")
            if r.resource_type == "CAMERA":
                has_camera = True
            if r.resource_type == "INSURANCE":
                has_insurance = True
            if r.resource_type == "PERMIT":
                has_permit = True

        if not has_camera:
            errors.append("Missing mandatory camera requirement.")
        if not has_insurance:
            errors.append("Missing mandatory insurance compliance requirement.")
        if not has_permit:
            errors.append("Missing mandatory forest permit requirement.")

        return len(errors) == 0, errors
