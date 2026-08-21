from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import Incident, RecoveryOption, CandidateVendor

class ProductionImpactAssessment(BaseModel):
    schedule_risk: str = "HIGH"
    budget_impact: float = 8000.0
    production_delay_without_recovery_days: int = 1
    notes: str = ""

class RecoveryPlanResult(BaseModel):
    incident_id: str
    resource_id: str
    impact: ProductionImpactAssessment
    options: List[RecoveryOption] = Field(default_factory=list)
    selected_option: Optional[str] = "CAM-002"
    selected_candidate: Optional[CandidateVendor] = None
    explanation: str
    next_action: str = "Request producer approval for recovery cost delta"
