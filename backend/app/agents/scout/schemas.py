from typing import List
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import ScoredCandidate

class ScoutSearchResult(BaseModel):
    recommendations: List[ScoredCandidate] = Field(default_factory=list)
    rejected_candidates: List[ScoredCandidate] = Field(default_factory=list)
    total_searched: int = 0
    total_eligible: int = 0
