"""Criterion 1. Requires `docker compose up -d` and a seeded database.

The producer and negotiation agents make real Gemini calls, so these tests
also require a live GEMINI_API_KEY in the environment/.env used by the
compose stack. Without one the pipeline dies at step 2 (decompose) with an
LLM auth error - see task-18-report.md for the exact failure captured on a
keyless run. skipif keeps a keyless CI/dev run honest instead of reporting a
confusing failure.
"""
import asyncio
import os

import httpx
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("GEMINI_API_KEY"),
        reason="requires a live GEMINI_API_KEY",
    ),
]

BASE = "http://localhost:8000"
BRIEF = {
    "brief_text": (
        "Three-day commercial shoot in Lisbon in early September. We need two camera "
        "packages, a small crew including aerial drone coverage over the waterfront, "
        "a riverside location, and transport for the team."
    ),
    "budget_cap": "150000.00",
    "location": "Lisbon",
    "start_date": "2026-09-01",
    "end_date": "2026-09-03",
}


async def _wait_for_terminal(client, production_id, headers, timeout=170):
    waited = 0.0
    while waited < timeout:
        body = (await client.get(f"/productions/{production_id}/status", headers=headers)).json()
        if body["status"] in {"booked", "awaiting_approval", "failed"}:
            return body
        await asyncio.sleep(1.0)
        waited += 1.0
    raise AssertionError(f"production did not settle within {timeout}s")


async def test_full_happy_path():
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        created = await client.post("/productions", headers=headers, json=BRIEF)
        assert created.status_code == 202, "must return immediately, not block on the pipeline"
        production_id = created.json()["production_id"]

        final = await _wait_for_terminal(client, production_id, headers)
        assert final["status"] in {"booked", "awaiting_approval"}, final

        # all ten steps reported done, in order
        done = [s["step"] for s in final["steps"] if s["status"] == "done"]
        assert sorted(set(done)) == list(range(1, 11)), f"missing steps: {sorted(set(done))}"

        # every agent actually participated
        trace = (await client.get(f"/productions/{production_id}/trace", headers=headers)).json()
        assert {"producer-agent", "scout-agent", "negotiation-agent",
                "compliance-agent"} <= set(trace["actors"]), trace["actors"]

        # negotiation was a real multi-round exchange, not a single number
        rounds = [e for e in trace["trace"] if e["action"] == "negotiation_round"]
        assert len(rounds) >= 2, "negotiation must show more than one round"
        assert any(r["payload"]["decision"] == "counter" for r in rounds), \
            "at least one vendor must have countered rather than instantly accepting"

        # every figure shown came from the DB
        assert final["total_cost"] is not None
        assert float(final["total_cost"]) > 0


async def test_sse_streams_incremental_progress():
    async with httpx.AsyncClient(base_url=BASE, timeout=180) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]

        seen = []
        async with client.stream("GET", f"/productions/{production_id}/events") as response:
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    seen.append(line)
                if line.startswith("event: end"):
                    break

        assert len(seen) >= 10, "the stream must show incremental progress, not one final blob"
