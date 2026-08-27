"""The one place vendor HTTP resilience lives. Timeout, exactly one retry,
then give up and let the caller decide on a fallback."""
from typing import Any

import httpx

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.http")
ATTEMPTS = 2  # initial call plus one retry


class VendorUnavailable(Exception):
    """The vendor did not answer usefully within the budget."""


async def request_with_retry(
    method: str,
    url: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    timeout: float | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    budget = timeout if timeout is not None else get_settings().vendor_timeout_s
    last: Exception | None = None

    async with httpx.AsyncClient(timeout=budget, transport=transport) as client:
        for attempt in range(1, ATTEMPTS + 1):
            try:
                response = await client.request(method, url, json=json, params=params)
                if response.status_code >= 500:
                    raise VendorUnavailable(f"{url} returned {response.status_code}")
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, VendorUnavailable) as exc:
                last = exc
                log.warning(
                    "vendor_call_failed",
                    extra={"url": url, "attempt": attempt, "error": str(exc)},
                )

    raise VendorUnavailable(f"{method} {url} failed after {ATTEMPTS} attempts: {last}")
