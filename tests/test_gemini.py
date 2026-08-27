from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from cinex.llm.gemini import GeminiClient, LLMError


class Shape(BaseModel):
    name: str
    count: int


def _client(monkeypatch, responses):
    client = GeminiClient(api_key="k", model="m", timeout_s=1.0)
    fake = AsyncMock(side_effect=responses)
    monkeypatch.setattr(client, "_raw_generate", fake)
    return client, fake


async def test_parses_valid_json(monkeypatch):
    client, fake = _client(monkeypatch, ['{"name": "camera", "count": 2}'])
    result = await client.generate_json("prompt", Shape)
    assert result == Shape(name="camera", count=2)
    assert fake.await_count == 1


async def test_repairs_once_on_malformed_json(monkeypatch):
    client, fake = _client(monkeypatch, ["not json at all", '{"name": "crew", "count": 5}'])
    result = await client.generate_json("prompt", Shape)
    assert result.count == 5
    assert fake.await_count == 2, "exactly one repair attempt"
    assert "valid JSON" in fake.await_args_list[1].args[0], "repair prompt must state the problem"


async def test_raises_after_the_repair_also_fails(monkeypatch):
    client, _ = _client(monkeypatch, ["garbage", "still garbage"])
    with pytest.raises(LLMError):
        await client.generate_json("prompt", Shape)


async def test_raises_when_schema_does_not_match(monkeypatch):
    client, _ = _client(monkeypatch, ['{"name": "x"}', '{"name": "x"}'])
    with pytest.raises(LLMError):
        await client.generate_json("prompt", Shape)
