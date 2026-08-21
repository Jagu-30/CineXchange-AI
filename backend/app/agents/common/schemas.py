from __future__ import annotations
from datetime import datetime, timezone
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator

class WorkflowState(str, Enum):
    DRAFT = "DRAFT"
    REQUIREMENTS_EXTRACTED = "REQUIREMENTS_EXTRACTED"
    SCOUTING = "SCOUTING"
    CANDIDATES_READY = "CANDIDATES_READY"
    NEGOTIATION_IN_PROGRESS = "NEGOTIATION_IN_PROGRESS"
    QUOTE_READY = "QUOTE_READY"
    COMPLIANCE_CHECKING = "COMPLIANCE_CHECKING"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    APPROVED = "APPROVED"
    BOOKED = "BOOKED"
    INCIDENT_DETECTED = "INCIDENT_DETECTED"
    RECOVERY_IN_PROGRESS = "RECOVERY_IN_PROGRESS"
    RECOVERY_APPROVAL_REQUIRED = "RECOVERY_APPROVAL_REQUIRED"
    RECOVERY_APPROVED = "RECOVERY_APPROVED"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"

class ProjectInput(BaseModel):
    project_id: str = Field(default="PROJ-001")
    title: str = Field(default="Rainforest Night Shoot")
    description: Optional[str] = None
    producer_request: str
    budget: float = Field(ge=0, description="Budget in INR ceiling")
    currency: str = "INR"
    duration_days: int = Field(gt=0, description="Shoot duration in days")
    start_date: Optional[str] = "2026-08-20"
    location: str = "Western Ghats rainforest"

class Requirement(BaseModel):
    requirement_id: str
    category: str
    resource: str
    resource_type: str
    quantity: int = Field(gt=0)
    duration_days: int = Field(gt=0)
    specifications: Dict[str, Any] = Field(default_factory=dict)
    priority: str = "CRITICAL"
    mandatory: bool = True
    notes: Optional[str] = None

class CandidateVendor(BaseModel):
    vendor_id: str
    vendor_name: str
    resource_id: str
    resource_name: str
    resource_type: str
    price: float = Field(ge=0)
    currency: str = "INR"
    available: bool = True
    delivery_days: int = 0
    distance_km: float = 0.0
    reliability_score: float = Field(ge=0, le=100)
    suitability_score: float = Field(ge=0, le=100)
    quality_score: float = Field(ge=0, le=100)
    insurance_included: bool = True
    insurance_required: bool = True
    location: str = ""
    specifications: Dict[str, Any] = Field(default_factory=dict)
    included_services: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ScoredCandidate(BaseModel):
    candidate: CandidateVendor
    hard_constraints_passed: bool = True
    score: float = Field(ge=0, le=100)
    score_breakdown: Dict[str, float] = Field(default_factory=dict)
    reasons: List[str] = Field(default_factory=list)
    rejected_reasons: List[str] = Field(default_factory=list)

class Quote(BaseModel):
    quote_id: str
    vendor_id: str
    resource_id: str
    price: float = Field(ge=0)
    currency: str = "INR"
    delivery_days: int = 0
    warranty_included: bool = True
    insurance_included: bool = True
    included_services: List[str] = Field(default_factory=list)
    quality_score: float = Field(ge=0, le=100)
    valid_until: Optional[str] = None
    terms: Dict[str, Any] = Field(default_factory=dict)

class NegotiationRound(BaseModel):
    round_number: int = Field(ge=1)
    offered_by: str  # "PRODUCER" or "VENDOR"
    price: float = Field(ge=0)
    savings_percent: float = 0.0
    included_terms: Dict[str, Any] = Field(default_factory=dict)
    message: str = ""
    accepted: bool = False
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class NegotiationState(BaseModel):
    negotiation_id: str
    vendor_id: str
    resource_id: str
    initial_price: float = Field(ge=0)
    current_price: float = Field(ge=0)
    target_price: float = Field(ge=0)
    minimum_price: float = Field(ge=0)
    rounds: int = Field(ge=0, le=5)
    max_rounds: int = 3
    target_savings_percent: float = 8.0
    minimum_acceptable_quality: float = 85.0
    insurance_required: bool = True
    max_delivery_days: int = 2
    status: str = "IN_PROGRESS"  # IN_PROGRESS, ACCEPTED, REJECTED, EXHAUSTED
    history: List[NegotiationRound] = Field(default_factory=list)
    reasoning: Optional[str] = None

    @field_validator("rounds")
    @classmethod
    def check_rounds_limit(cls, v: int, info: Any) -> int:
        return v

class CounterOfferInput(BaseModel):
    price: float = Field(ge=0)
    requested_terms: Dict[str, Any] = Field(default_factory=dict)
    reason: Optional[str] = None

class ComplianceDocument(BaseModel):
    document_id: str
    document_type: str  # INSURANCE, CONTRACT, PERMIT, LICENSE
    vendor_id: str
    vendor_name: str
    valid_from: str
    valid_until: str
    coverage_amount: float = Field(ge=0)
    status: str = "VALID"  # VALID, EXPIRED, INSUFFICIENT, PENDING, MISSING
    extraction_confidence: float = Field(ge=0, le=1)
    extracted_fields: Dict[str, Any] = Field(default_factory=dict)
    source_reference: Optional[str] = None

class RiskBreakdown(BaseModel):
    vendor_risk: int = Field(ge=0, le=5)
    contract_risk: int = Field(ge=0, le=5)
    insurance_risk: int = Field(ge=0, le=5)
    permit_risk: int = Field(ge=0, le=5)
    financial_risk: int = Field(ge=0, le=5)
    overall_level: str = "LOW"  # LOW, MEDIUM, HIGH, BLOCKED
    reasons: List[str] = Field(default_factory=list)

class ApprovalDecision(BaseModel):
    approval_id: str
    status: str = "PENDING_PRODUCER_APPROVAL"  # AUTO_APPROVED, PENDING_PRODUCER_APPROVAL, APPROVED, REJECTED, BLOCKED
    requires_producer_approval: bool = True
    blocking_reasons: List[str] = Field(default_factory=list)
    approval_reasons: List[str] = Field(default_factory=list)
    next_action: str = ""
    risk: RiskBreakdown

class Incident(BaseModel):
    incident_id: str
    event: str = "RESOURCE_UNAVAILABLE"
    resource_id: str
    occurred_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    severity: str = "HIGH"
    details: Dict[str, Any] = Field(default_factory=dict)

class RecoveryOption(BaseModel):
    candidate: CandidateVendor
    compatibility_score: float = Field(ge=0, le=100)
    availability_score: float = Field(ge=0, le=100)
    schedule_score: float = Field(ge=0, le=100)
    cost_score: float = Field(ge=0, le=100)
    reliability_score: float = Field(ge=0, le=100)
    insurance_score: float = Field(ge=0, le=100)
    total_score: float = Field(ge=0, le=100)
    cost_delta: float
    schedule_delay_days: int = 0
    reasons: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)

class BookingRecord(BaseModel):
    booking_id: str
    resource_id: str
    resource_name: str
    vendor_id: str
    vendor_name: str
    price: float = Field(ge=0)
    status: str = "CONFIRMED"  # CONFIRMED, AT_RISK, REPLACED, CANCELLED
    delivery_date: str = "2026-08-20"
    insurance_covered: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AuditLogEntry(BaseModel):
    entry_id: str = Field(default_factory=lambda: f"AUDIT-{uuid.uuid4().hex[:8].upper()}")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    agent: str
    agent_name: str
    action: str
    status: str  # processing, successful, approval_required, blocked, failed, recommendation
    input_summary: str
    output_summary: str
    policy_checks: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    next_action: str = ""

class ProductionState(BaseModel):
    project: ProjectInput
    current_state: WorkflowState = WorkflowState.DRAFT
    requirements: List[Requirement] = Field(default_factory=list)
    candidates: List[ScoredCandidate] = Field(default_factory=list)
    quotes: List[Quote] = Field(default_factory=list)
    negotiations: List[NegotiationState] = Field(default_factory=list)
    compliance: List[ComplianceDocument] = Field(default_factory=list)
    risk_assessments: Optional[RiskBreakdown] = None
    approvals: List[ApprovalDecision] = Field(default_factory=list)
    bookings: List[BookingRecord] = Field(default_factory=list)
    incidents: List[Incident] = Field(default_factory=list)
    recovery_options: List[RecoveryOption] = Field(default_factory=list)
    audit_log: List[AuditLogEntry] = Field(default_factory=list)

class APIResponseEnvelope(BaseModel):
    success: bool = True
    data: Optional[Any] = None
    errors: List[str] = Field(default_factory=list)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    request_id: str = ""

class OperationalEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: f"EVT-{uuid.uuid4().hex[:8].upper()}")
    event_type: str  # project_created, requirements_extracted, scout_completed, etc.
    project_id: str
    resource_id: Optional[str] = None
    vendor_id: Optional[str] = None
    agent_name: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    severity: str = "INFO"  # INFO, WARNING, ERROR, CRITICAL
    payload: Dict[str, Any] = Field(default_factory=dict)
    trace_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    source: str = "cinexchange-ai"
    external_incident_id: Optional[str] = None
