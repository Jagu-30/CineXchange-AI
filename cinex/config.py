from decimal import Decimal
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service: str = "orchestrator"

    database_url: str
    clickhouse_url: str = "http://clickhouse:8123"
    jwt_secret: str
    demo_producer_id: str = "11111111-1111-1111-1111-111111111111"

    gemini_api_key: str
    gemini_model: str

    # Vertex AI is the hosted-on-GCP path: the SDK authenticates with the
    # runtime service account (ADC) instead of an API key, so there is no
    # long-lived secret to leak from a container. Off by default so local dev
    # and the compose stack keep using GEMINI_API_KEY unchanged.
    gemini_use_vertex: bool = False
    gcp_project: str = "cine-xchange"
    gcp_location: str = "us-central1"

    # Comma-separated list of browser origins allowed to call this API.
    frontend_origin: str = "http://localhost:3000"

    approval_threshold_pct: float = 10.0
    negotiation_max_rounds: int = 3
    vendor_timeout_s: float = 5.0
    llm_timeout_s: float = 30.0
    # One run makes 22-37 Gemini calls, most of them concurrent. These bound
    # the burst and the retry budget when the provider answers 429/503.
    llm_max_concurrency: int = 4
    llm_max_attempts: int = 4
    insurance_rider_threshold: Decimal = Decimal("50000")

    producer_agent_url: str = "http://producer-agent:8001/mcp"
    scout_agent_url: str = "http://scout-agent:8002/mcp"
    negotiation_agent_url: str = "http://negotiation-agent:8003/mcp"
    compliance_agent_url: str = "http://compliance-agent:8004/mcp"
    recovery_agent_url: str = "http://recovery-agent:8005/mcp"

    def allowed_origins(self) -> list[str]:
        """FRONTEND_ORIGIN as a list. One origin or a comma-separated set.

        Deliberately never expands to ``*``: the API is called with
        ``Authorization`` headers and ``allow_credentials=True``, and the CORS
        spec forbids a wildcard origin on a credentialed request - the browser
        would reject every response. An empty/blank value yields an empty list,
        which means "no cross-origin browser access", not "everyone".
        """
        return [origin.strip() for origin in self.frontend_origin.split(",") if origin.strip()]

    def agent_urls(self) -> dict[str, str]:
        return {
            "producer": self.producer_agent_url,
            "scout": self.scout_agent_url,
            "negotiation": self.negotiation_agent_url,
            "compliance": self.compliance_agent_url,
            "recovery": self.recovery_agent_url,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
