import json
from types import SimpleNamespace

import pytest

from cinex.mcp_client import AgentClients, AgentUnavailable, unwrap_result


def test_unwrap_prefers_structured_data():
    result = SimpleNamespace(data={"offers": [1, 2]}, content=[])
    assert unwrap_result(result) == {"offers": [1, 2]}


def test_unwrap_falls_back_to_text_content():
    result = SimpleNamespace(data=None, content=[SimpleNamespace(text=json.dumps({"ok": True}))])
    assert unwrap_result(result) == {"ok": True}


def test_unwrap_raises_on_an_unusable_result():
    with pytest.raises(AgentUnavailable):
        unwrap_result(SimpleNamespace(data=None, content=[]))


async def test_unknown_agent_is_an_error():
    clients = AgentClients({"scout": "http://scout:8002/mcp"})
    with pytest.raises(AgentUnavailable, match="unknown agent"):
        await clients.call("nope", "tool", {})
