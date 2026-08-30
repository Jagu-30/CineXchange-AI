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


# --------------------------------------------------------------------------
# Rate-limit backoff. A single production run makes 22-37 Gemini calls, most
# of them concurrent, so 429 is an expected condition rather than an edge case.
# --------------------------------------------------------------------------

import asyncio as _asyncio

import pytest as _pytest
from google.genai import errors as _genai_errors

from cinex.llm.gemini import GeminiClient as _GeminiClient, LLMRateLimited as _LLMRateLimited


class _Shape(BaseModel):
    ok: bool


def _quota_error(code: int = 429):
    return _genai_errors.ClientError(
        code, {"error": {"code": code, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}
    )


def _client_with(monkeypatch, responses, **kw):
    """A client whose underlying generate_content replays `responses`.

    Sleeps are stubbed out so the backoff schedule is exercised without the
    test actually waiting through it.
    """
    monkeypatch.setattr("cinex.llm.gemini.genai.Client", lambda **_: object())
    client = _GeminiClient(api_key="k", model="m", timeout_s=5.0, **kw)
    slept: list[float] = []

    async def fake_sleep(d):
        slept.append(d)

    monkeypatch.setattr(_asyncio, "sleep", fake_sleep)

    calls = {"n": 0}

    async def fake_generate(**_):
        i = calls["n"]
        calls["n"] += 1
        item = responses[min(i, len(responses) - 1)]
        if isinstance(item, Exception):
            raise item
        return type("R", (), {"text": item})()

    class _Models:
        generate_content = staticmethod(fake_generate)

    client._client = type("C", (), {"aio": type("A", (), {"models": _Models})()})()
    return client, calls, slept


async def test_retries_after_a_429_then_succeeds(monkeypatch):
    client, calls, slept = _client_with(monkeypatch, [_quota_error(), '{"ok": true}'])
    result = await client.generate_json("p", _Shape)
    assert result.ok is True
    assert calls["n"] == 2
    assert len(slept) == 1, "exactly one backoff before the successful retry"


async def test_503_is_also_retried(monkeypatch):
    client, calls, _ = _client_with(
        monkeypatch, [_genai_errors.ServerError(503, {"error": {"code": 503}}), '{"ok": true}']
    )
    assert (await client.generate_json("p", _Shape)).ok is True
    assert calls["n"] == 2


async def test_gives_up_as_LLMRateLimited_after_max_attempts(monkeypatch):
    client, calls, slept = _client_with(monkeypatch, [_quota_error()], max_attempts=3)
    with _pytest.raises(_LLMRateLimited):
        await client.generate_json("p", _Shape)
    assert calls["n"] == 3, "attempts are bounded by max_attempts"
    assert len(slept) == 2, "no sleep after the final attempt"


async def test_backoff_grows_and_is_jittered(monkeypatch):
    client, _, slept = _client_with(monkeypatch, [_quota_error()], max_attempts=4)
    with _pytest.raises(_LLMRateLimited):
        await client.generate_json("p", _Shape)
    assert slept[0] < slept[1] < slept[2], f"expected growth, got {slept}"
    assert slept[0] >= 2.0 and slept[1] >= 4.0


async def test_a_non_capacity_error_is_not_retried(monkeypatch):
    """A 400 is our bug, not the provider's load. Retrying it just burns quota."""
    client, calls, _ = _client_with(monkeypatch, [_genai_errors.ClientError(400, {"error": {"code": 400}})])
    with _pytest.raises(_genai_errors.ClientError):
        await client.generate_json("p", _Shape)
    assert calls["n"] == 1


async def test_concurrency_is_capped(monkeypatch):
    monkeypatch.setattr("cinex.llm.gemini.genai.Client", lambda **_: object())
    client = _GeminiClient(api_key="k", model="m", timeout_s=5.0, max_concurrency=2)
    live = 0
    peak = 0

    async def fake_generate(**_):
        nonlocal live, peak
        live += 1
        peak = max(peak, live)
        await _asyncio.sleep(0)
        live -= 1
        return type("R", (), {"text": '{"ok": true}'})()

    class _Models:
        generate_content = staticmethod(fake_generate)

    client._client = type("C", (), {"aio": type("A", (), {"models": _Models})()})()
    await _asyncio.gather(*[client.generate_json("p", _Shape) for _ in range(10)])
    assert peak <= 2, f"semaphore should cap in-flight calls at 2, saw {peak}"
