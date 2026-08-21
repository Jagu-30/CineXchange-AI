from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import ProjectInput, Incident, CounterOfferInput

class CreatePlanRequest(BaseModel):
    project_id: str = "PROJ-001"
    title: str = "Rainforest Night Shoot"
    description: Optional[str] = "Two low-light rainforest scenes over three days."
    producer_request: str = "We need to shoot two low-light rainforest scenes over three days within ₹25 lakh."
    budget: float = 2500000.0
    currency: str = "INR"
    duration_days: int = 3
    location: str = "Western Ghats rainforest"

class StartNegotiationRequest(BaseModel):
    vendor_id: str = "V003"
    resource_id: str = "CAM-002"

class CounterOfferApiRequest(BaseModel):
    price: float = Field(ge=0)
    requested_terms: Dict[str, Any] = Field(default_factory=lambda: {
        "insurance": True,
        "delivery_days": 1,
        "warranty": True
    })
    reason: Optional[str] = None

class CreateIncidentApiRequest(BaseModel):
    event: str = "RESOURCE_UNAVAILABLE"
    resource_id: str = "CAM-001"
    severity: str = "HIGH"
    details: Dict[str, Any] = Field(default_factory=lambda: {
        "message": "Booked camera became unavailable mid-shoot"
    })

class ApproveRecoveryApiRequest(BaseModel):
    recovery_option_id: str = "CAM-002"
    notes: Optional[str] = "Approved cost delta for replacement Sony FX9 package"

class ProducerApprovalApiRequest(BaseModel):
    notes: Optional[str] = "Producer approved package commitments"
