from typing import List
from pydantic import BaseModel, Field
from backend.app.agents.common.schemas import Requirement

class ProducerExtractionOutput(BaseModel):
    requirements: List[Requirement] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    missing_information: List[str] = Field(default_factory=list)
    clarification_needed: bool = False
