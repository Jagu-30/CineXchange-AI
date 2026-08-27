from decimal import Decimal

import pytest
from pydantic import ValidationError

from cinex.config import Settings

# Settings reads .env by default. These tests must not depend on whatever a
# developer happens to have in theirs, so every construction here passes
# _env_file=None and supplies its inputs explicitly.


def _base(**over):
    defaults = dict(
        database_url="postgresql+asyncpg://u:p@localhost/db",
        gemini_api_key="k",
        gemini_model="m",
        jwt_secret="s",
    )
    return Settings(_env_file=None, **(defaults | over))


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
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="x", gemini_model="m", jwt_secret="s")


def test_defaults_are_not_read_from_a_developers_env_file():
    """Guards the hermeticity the other tests rely on."""
    s = _base(negotiation_max_rounds=7)
    assert s.negotiation_max_rounds == 7
    assert Settings(
        _env_file=None,
        database_url="x",
        gemini_api_key="k",
        gemini_model="m",
        jwt_secret="s",
    ).negotiation_max_rounds == 3
