import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    USE_MOCK_BACKEND: bool = True
    USE_GEMINI: bool = False
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    FRONTEND_ORIGIN: str = "http://localhost:3000"
    MAX_NEGOTIATION_ROUNDS: int = 3
    TARGET_SAVINGS_PERCENT: float = 8.0
    MIN_ACCEPTABLE_QUALITY: float = 85.0
    HIGH_VALUE_APPROVAL_THRESHOLD: float = 1000000.0
    DEFAULT_CURRENCY: str = "INR"
    AUTO_APPROVE_LOW_RISK: bool = True

    # Grafana integration
    GRAFANA_MODE: str = "mock"  # "mock" | "cloud_mcp"
    GRAFANA_URL: str = ""
    GRAFANA_SERVICE_ACCOUNT_TOKEN: str = ""
    GRAFANA_MCP_URL: str = ""
    GRAFANA_ORG_ID: str = ""
    GRAFANA_INCIDENT_LABEL: str = "cinexchange"

    # ClickHouse integration
    CLICKHOUSE_MODE: str = "mock"  # "mock" | "cloud"
    CLICKHOUSE_HOST: str = ""
    CLICKHOUSE_PORT: int = 8443
    CLICKHOUSE_DATABASE: str = "cinexchange"
    CLICKHOUSE_USERNAME: str = ""
    CLICKHOUSE_PASSWORD: str = ""
    CLICKHOUSE_SECURE: bool = True

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
