from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import ComplianceDocument, RiskBreakdown, ApprovalDecision

class DocumentExtractionRequest(BaseModel):
    document_id: str
    document_type: str
    vendor_id: str
    document_text: Optional[str] = None
    mock_file_name: Optional[str] = None

class ComplianceEvaluationResult(BaseModel):
    documents: List[ComplianceDocument] = Field(default_factory=list)
    risk: RiskBreakdown
    approval: ApprovalDecision
    all_mandatory_valid: bool
    summary: str
