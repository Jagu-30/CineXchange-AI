"""Gemini access. Live only - there is deliberately no offline implementation.

If Task 1's dependency probe recorded a different google-genai surface than the
one used in _raw_generate, change _raw_generate and nothing else.
"""
import asyncio
import json
from functools import lru_cache
from typing import TypeVar

from google import genai
from pydantic import BaseModel, ValidationError

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """The model did not return something matching the requested schema."""


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout_s: float) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._timeout_s = timeout_s

    async def _raw_generate(self, prompt: str, schema: type[BaseModel]) -> str:
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
    )
