from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from cinex.llm import gemini as gemini_module
from cinex.llm.gemini import GeminiClient, LLMError


class Shape(BaseModel):
    name: str
    count: int


def _client(monkeypatch, responses):
    client = GeminiClient(api_key="k", model="m", timeout_s=1.0)
    fake = AsyncMock(side_effect=responses)
    monkeypatch.setattr(client, "_raw_generate", fake)
    return client, fake


class _RecordingClientFactory:
    """Stands in for genai.Client and records exactly how it was constructed.

    Nothing here ever opens a socket - the whole point is to assert the two
    construction paths without contacting Google.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return object()

    @property
    def kwargs(self) -> dict:
        assert len(self.calls) == 1, f"expected exactly one genai.Client(), got {len(self.calls)}"
        return self.calls[0]


@pytest.fixture
def genai_client(monkeypatch) -> _RecordingClientFactory:
    factory = _RecordingClientFactory()
    monkeypatch.setattr(gemini_module.genai, "Client", factory)
    return factory


def test_developer_api_path_constructs_with_an_api_key(genai_client):
    """use_vertex=False is the original path and must be byte-for-byte unchanged."""
    GeminiClient(api_key="secret-key", model="m", timeout_s=1.0, use_vertex=False)

    assert genai_client.kwargs == {"api_key": "secret-key"}


def test_vertex_path_constructs_with_project_and_location(genai_client):
    GeminiClient(
        api_key="secret-key", model="m", timeout_s=1.0,
        use_vertex=True, project="cine-xchange", location="us-central1",
    )

    assert genai_client.kwargs == {
        "vertexai": True, "project": "cine-xchange", "location": "us-central1",
    }


def test_vertex_path_never_passes_the_api_key(genai_client):
    """Vertex authenticates with ADC. Passing the key alongside it would put a
    long-lived secret back into a deployment that does not need one."""
    GeminiClient(
        api_key="secret-key", model="m", timeout_s=1.0,
        use_vertex=True, project="p", location="l",
    )

    assert "api_key" not in genai_client.kwargs
    assert "secret-key" not in genai_client.kwargs.values()


@pytest.mark.parametrize(
    "project,location",
    [("", "us-central1"), ("cine-xchange", ""), ("", ""), (None, None)],
    ids=["no-project", "no-location", "neither", "both-none"],
)
def test_vertex_without_project_or_location_is_an_error(genai_client, project, location):
    """Fail loudly at construction rather than emitting a confusing SDK error on
    the first generate call, halfway through a live demo."""
    with pytest.raises(LLMError) as exc:
        GeminiClient(
            api_key="secret-key", model="m", timeout_s=1.0,
            use_vertex=True, project=project, location=location,
        )

    assert "gcp_project" in str(exc.value) and "gcp_location" in str(exc.value)
    assert genai_client.calls == [], "no client may be constructed on the error path"


def test_get_llm_wires_the_vertex_settings_through(monkeypatch, genai_client):
    """The class is only half the story - get_llm() has to pass the settings."""
    from cinex.config import Settings

    settings = Settings(
        _env_file=None, database_url="postgresql+asyncpg://u:p@h/db",
        gemini_api_key="secret-key", gemini_model="m", jwt_secret="s",
        gemini_use_vertex=True, gcp_project="proj-x", gcp_location="loc-y",
    )
    monkeypatch.setattr(gemini_module, "get_settings", lambda: settings)

    gemini_module.get_llm.cache_clear()
    try:
        client = gemini_module.get_llm()
    finally:
        # lru_cache is process-wide; a Vertex-configured client must not leak
        # into any test that runs after this one.
        gemini_module.get_llm.cache_clear()

    assert client._model == "m"
    assert genai_client.kwargs == {"vertexai": True, "project": "proj-x", "location": "loc-y"}


def test_get_llm_defaults_to_the_developer_api(monkeypatch, genai_client):
    from cinex.config import Settings

    settings = Settings(
        _env_file=None, database_url="postgresql+asyncpg://u:p@h/db",
        gemini_api_key="secret-key", gemini_model="m", jwt_secret="s",
    )
    assert settings.gemini_use_vertex is False, "the default must stay off"
    monkeypatch.setattr(gemini_module, "get_settings", lambda: settings)

    gemini_module.get_llm.cache_clear()
    try:
        gemini_module.get_llm()
    finally:
        gemini_module.get_llm.cache_clear()

    assert genai_client.kwargs == {"api_key": "secret-key"}


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
