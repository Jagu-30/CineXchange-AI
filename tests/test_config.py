from decimal import Decimal
import pytest
from cinex.config import Settings


def _base(**over):
    defaults = dict(
        database_url="postgresql+asyncpg://u:p@localhost/db",
        gemini_api_key="k",
        gemini_model="m",
        jwt_secret="s",
    )
    return Settings(**(defaults | over))


def test_demo_defaults():
    s = _base()
    assert s.negotiation_max_rounds == 3
    assert s.approval_threshold_pct == 10.0
    assert s.vendor_timeout_s == 5.0
    assert s.insurance_rider_threshold == Decimal("50000")
    assert isinstance(s.insurance_rider_threshold, Decimal), "money is Decimal, never float"


def test_agent_urls_are_configurable():
    s = _base(scout_agent_url="http://scout:8002/mcp")
    assert s.agent_urls()["scout"] == "http://scout:8002/mcp"
    assert set(s.agent_urls()) == {"producer", "scout", "negotiation", "compliance", "recovery"}


def test_missing_required_key_is_an_error():
    with pytest.raises(Exception):
        Settings(database_url="x", gemini_model="m", jwt_secret="s")
