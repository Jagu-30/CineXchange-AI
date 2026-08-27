"""Criterion 2. Requires `docker compose up -d` and a seeded database.

The happy path these tests run first to reach a `booked` production makes real
Gemini calls (producer and negotiation agents), so these tests also require a
live GEMINI_API_KEY in the environment/.env used by the compose stack. Without
one the pipeline dies at step 2 (decompose) with an LLM auth error before the
recovery endpoint is ever reached - see task-18-report.md for the exact
failure captured on a keyless run. skipif keeps a keyless CI/dev run honest
instead of reporting a confusing failure.
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
STEP_NAMES = [
    "find_replacement", "negotiate_replacement", "recalculate_cost",
    "check_schedule", "update_records", "present_diff", "approval_gate",
]


async def _settle(client, production_id, headers, timeout=170):
    waited = 0.0
    while waited < timeout:
        body = (await client.get(f"/productions/{production_id}/status", headers=headers)).json()
        if body["status"] in {"booked", "awaiting_approval", "failed"}:
            return body
        await asyncio.sleep(1.0)
        waited += 1.0
    raise AssertionError("production did not settle")


async def test_recovery_produces_a_seven_step_timeline():
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)

        # approve if the happy path parked, so there is a confirmed booking to break
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            before = await _settle(client, production_id, headers)
        assert before["status"] == "booked", before

        recovery = await client.post(f"/productions/{production_id}/recovery",
                                     headers=headers, json={"trigger": "vendor_unavailable"})
        assert recovery.status_code == 200, recovery.text
        body = recovery.json()

        assert [e["step"] for e in body["timeline"]] == list(range(1, 8))
        assert [e["name"] for e in body["timeline"]] == STEP_NAMES
        assert body["outcome"] in {"resolved", "awaiting_approval"}

        # the cost delta came from real rows
        recalc = next(e for e in body["timeline"] if e["name"] == "recalculate_cost")
        assert recalc["detail"]["old_total"] != recalc["detail"]["new_total"]


async def test_recovery_never_asks_for_the_brief_again():
    """The claim the demo rests on: no endpoint required the original brief."""
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            await _settle(client, production_id, headers)

        # note the empty body - nothing but the production id in the URL
        response = await client.post(f"/productions/{production_id}/recovery",
                                     headers=headers, json={})
        assert response.status_code == 200
        assert len(response.json()["timeline"]) == 7


async def test_re_triggering_recovery_is_idempotent():
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            await _settle(client, production_id, headers)

        first = (await client.post(f"/productions/{production_id}/recovery",
                                   headers=headers, json={})).json()
        second = (await client.post(f"/productions/{production_id}/recovery",
                                    headers=headers, json={})).json()

        if first["outcome"] == "awaiting_approval":
            assert second["recovery_event_id"] == first["recovery_event_id"]
            assert second["outcome"] == "already_in_progress"
