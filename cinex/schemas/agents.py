from pydantic import BaseModel, Field

CATEGORIES = ("camera", "crew", "location", "transport", "insurance", "permit")


class SpecDetail(BaseModel):
    """One free-form specification, as a key/value pair.

    This is a list of pairs rather than an open ``dict`` on purpose. A bare
    ``dict`` renders into JSON Schema as ``additionalProperties``, and the
    Gemini Developer API rejects that outright:

        additionalProperties is only supported in Gemini Enterprise Agent
        Platform mode, not in Gemini Developer API mode.

    Pairs keep the field open-ended while staying inside the subset of JSON
    Schema the structured-output API actually accepts.
    """

    key: str = Field(description="detail name, e.g. model, lens, capacity, dates")
    value: str = Field(description="the value, as text")


class RequirementDraft(BaseModel):
    category: str = Field(description=f"exactly one of: {', '.join(CATEGORIES)}")
    role: str = Field(
        default="",
        description="for crew only: the role, e.g. 'drone operator'. Empty for other categories.",
    )
    requires_certification: bool = Field(
        default=False,
        description="true if this role legally requires a licence (drone operator, pyrotechnics, stunts, underwater)",
    )
    details: list[SpecDetail] = Field(
        default_factory=list,
        description="any other specifics: model, lens, dates, capacity, permit authority",
    )
    quantity: int = Field(ge=1, default=1)
    priority: int = Field(ge=1, le=3, default=2, description="1 is highest")

    def to_spec(self) -> dict:
        """Flatten to the JSONB shape stored on ``requirements.spec``.

        ``role`` and ``requires_certification`` are promoted to top-level keys
        because ``compliance_agent.rules.check_licensing`` reads them there.
        """
        spec: dict = {detail.key: detail.value for detail in self.details}
        if self.role:
            spec["role"] = self.role
        spec["requires_certification"] = self.requires_certification
        return spec


class Decomposition(BaseModel):
    requirements: list[RequirementDraft]


class NegotiationStrategy(BaseModel):
    counter_price: float = Field(description="the price to offer this round")
    concede_terms: list[str] = Field(default_factory=list)
    walk_away: bool = False
    rationale: str = ""
