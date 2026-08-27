from pydantic import BaseModel, Field

CATEGORIES = ("camera", "crew", "location", "transport", "insurance", "permit")


class RequirementDraft(BaseModel):
    category: str = Field(description=f"exactly one of: {', '.join(CATEGORIES)}")
    spec: dict = Field(default_factory=dict, description="free-form details: model, role, dates, certifications")
    quantity: int = Field(ge=1, default=1)
    priority: int = Field(ge=1, le=3, default=2, description="1 is highest")


class Decomposition(BaseModel):
    requirements: list[RequirementDraft]


class NegotiationStrategy(BaseModel):
    counter_price: float = Field(description="the price to offer this round")
    concede_terms: list[str] = Field(default_factory=list)
    walk_away: bool = False
    rationale: str = ""
