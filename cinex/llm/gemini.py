"""Gemini access. Live only - there is deliberately no offline implementation.

If Task 1's dependency probe recorded a different google-genai surface than the
one used in _raw_generate, change _raw_generate and nothing else.
"""
import asyncio
import json
import random
from functools import lru_cache
from typing import TypeVar

from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel, ValidationError

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.llm")
T = TypeVar("T", bound=BaseModel)

# A single production run makes one decompose call plus one negotiation-strategy
# call per requirement per round - 22 to 37 calls with the observed 7-12
# requirements at 3 rounds, most of them fanned out concurrently. Without
# throttling and backoff that reliably trips 429 RESOURCE_EXHAUSTED partway
# through, which kills the run after real vendor state has already changed.
RATE_LIMITED = (429, 503)
BACKOFF_BASE_S = 2.0
BACKOFF_MAX_S = 32.0


class LLMError(Exception):
    """The model did not return something matching the requested schema."""


class LLMRateLimited(LLMError):
    """The provider refused the call for capacity reasons, after backoff."""


class GeminiClient:
    """Two construction paths, one call surface.

    ``use_vertex=False`` (the default) is the Gemini Developer API and is
    byte-for-byte what this class has always done: ``genai.Client(api_key=...)``.

    ``use_vertex=True`` is the Vertex AI path used when this runs on Google
    Cloud. The SDK then authenticates with Application Default Credentials -
    the runtime service account attached to the Cloud Run / GKE workload - so
    ``api_key`` is not passed at all and the deployment carries no leakable
    secret. Everything below ``__init__`` is identical either way; only the
    transport and the auth differ.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_s: float,
        *,
        use_vertex: bool = False,
        project: str | None = None,
        location: str | None = None,
        max_concurrency: int = 4,
        max_attempts: int = 4,
    ) -> None:
        if use_vertex:
            if not project or not location:
                raise LLMError(
                    "gemini_use_vertex is set but gcp_project/gcp_location are empty; "
                    "Vertex AI needs both."
                )
            # No api_key here, on purpose. Passing one alongside vertexai=True
            # would put the secret back into the deployment for no benefit.
            self._client = genai.Client(vertexai=True, project=project, location=location)
        else:
            self._client = genai.Client(api_key=api_key)
        self._model = model
        self._timeout_s = timeout_s
        self._max_attempts = max_attempts
        # Caps in-flight calls so the concurrent fan-out across requirements
        # does not arrive at the provider as one burst.
        self._gate = asyncio.Semaphore(max_concurrency)

    @staticmethod
    def _status_of(exc: Exception) -> int | None:
        code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        return code if isinstance(code, int) else None

    async def _raw_generate(self, prompt: str, schema: type[BaseModel]) -> str:
        """One call, retrying only on capacity errors.

        Backoff is exponential with jitter. The jitter matters: without it a
        fan-out that all trips 429 at once would retry in lockstep and trip it
        again together.
        """
        last: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                async with self._gate:
                    response = await asyncio.wait_for(
                        self._client.aio.models.generate_content(
                            model=self._model,
                            contents=prompt,
                            config={
                                "response_mime_type": "application/json",
                                "response_schema": schema,
                                "temperature": 0.2,
                            },
                        ),
                        timeout=self._timeout_s,
                    )
                return response.text
            except (genai_errors.ClientError, genai_errors.ServerError) as exc:
                status = self._status_of(exc)
                if status not in RATE_LIMITED:
                    raise
                last = exc
                if attempt == self._max_attempts:
                    break
                delay = min(BACKOFF_BASE_S * 2 ** (attempt - 1), BACKOFF_MAX_S)
                delay += random.uniform(0, delay / 2)
                log.warning(
                    "llm_rate_limited",
                    extra={"status": status, "attempt": attempt, "sleep_s": round(delay, 1)},
                )
                await asyncio.sleep(delay)

        raise LLMRateLimited(
            f"gemini refused {self._max_attempts} attempts with {self._status_of(last)}: {last}"
        )

    async def generate_json(self, prompt: str, schema: type[T]) -> T:
        attempts = [prompt]
        last_error = ""

        for attempt, current in enumerate(attempts, start=1):
            try:
                raw = await self._raw_generate(current, schema)
                return schema.model_validate(json.loads(raw))
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = str(exc)
                log.warning("llm_bad_output", extra={"attempt": attempt, "error": last_error})
                if attempt == 1:
                    attempts.append(
                        f"{prompt}\n\n"
                        f"Your previous reply was not valid JSON matching the required schema. "
                        f"The parser reported: {last_error}\n"
                        f"Reply with valid JSON conforming exactly to the schema, and nothing else."
                    )
            except asyncio.TimeoutError as exc:
                raise LLMError(f"gemini timed out after {self._timeout_s}s") from exc

        raise LLMError(f"gemini returned unusable output twice: {last_error}")


@lru_cache
def get_llm() -> GeminiClient:
    settings = get_settings()
    return GeminiClient(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        timeout_s=settings.llm_timeout_s,
        use_vertex=settings.gemini_use_vertex,
        project=settings.gcp_project,
        location=settings.gcp_location,
        max_concurrency=settings.llm_max_concurrency,
        max_attempts=settings.llm_max_attempts,
    )
