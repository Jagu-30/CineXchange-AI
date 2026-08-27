from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import Quote, NegotiationRound, NegotiationState

class NegotiationInitRequest(BaseModel):
    vendor_id: str
    resource_id: str
    initial_quote_price: Optional[float] = None

class CounterOfferRequest(BaseModel):
    price: float = Field(ge=0)
    requested_terms: Dict[str, Any] = Field(default_factory=dict)
    rationale: Optional[str] = None

class NegotiationResponse(BaseModel):
    negotiation_state: NegotiationState
    vendor_message: str
    policy_compliant: bool
    policy_notes: List[str] = Field(default_factory=list)
    suggested_next_counter: Optional[float] = None
