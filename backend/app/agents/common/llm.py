import json
import logging
from typing import Any, Dict, Optional, Type, TypeVar
from pydantic import BaseModel
from backend.app.config import settings

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

class GeminiLLMClient:
    """Interface to Gemini with structured output extraction and deterministic fallback."""

    def __init__(self):
        self.enabled = settings.USE_GEMINI and bool(settings.GEMINI_API_KEY)
        self.model_name = settings.GEMINI_MODEL
        self._client = None
        if self.enabled:
            try:
                from google import genai
                self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
            except Exception as e:
                logger.warning(f"Failed to initialize Google GenAI client: {e}. Falling back to mock mode.")
                self.enabled = False

    def generate_structured(
        self,
        prompt: str,
        system_instruction: str,
        response_model: Type[T],
        fallback_data: Dict[str, Any]
    ) -> T:
        """Generates structured response from Gemini or returns validated fallback data."""
        if not self.enabled or not self._client:
            return response_model.model_validate(fallback_data)

        try:
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config={
                    "system_instruction": system_instruction,
                    "response_mime_type": "application/json",
                    "response_schema": response_model,
                }
            )
            if response.text:
                parsed = json.loads(response.text)
                return response_model.model_validate(parsed)
        except Exception as e:
            logger.error(f"Gemini generation error: {e}. Utilizing deterministic fallback.")

        return response_model.model_validate(fallback_data)

    def generate_text(self, prompt: str, system_instruction: str, fallback_text: str) -> str:
        """Generates textual explanation/negotiation counter from Gemini with fallback."""
        if not self.enabled or not self._client:
            return fallback_text

        try:
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config={"system_instruction": system_instruction}
            )
            if response.text:
                return response.text.strip()
        except Exception as e:
            logger.error(f"Gemini text generation error: {e}. Utilizing fallback text.")

        return fallback_text

gemini_client = GeminiLLMClient()
