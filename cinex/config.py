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

    approval_threshold_pct: float = 10.0
    negotiation_max_rounds: int = 3
    vendor_timeout_s: float = 5.0
    llm_timeout_s: float = 30.0
    insurance_rider_threshold: Decimal = Decimal("50000")

    producer_agent_url: str = "http://producer-agent:8001/mcp"
    scout_agent_url: str = "http://scout-agent:8002/mcp"
    negotiation_agent_url: str = "http://negotiation-agent:8003/mcp"
    compliance_agent_url: str = "http://compliance-agent:8004/mcp"
    recovery_agent_url: str = "http://recovery-agent:8005/mcp"

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
