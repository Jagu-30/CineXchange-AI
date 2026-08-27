"""Demo-hardening health check: every service in the compose stack answers
/healthz, and the orchestrator's own /healthz proves it can reach all five
agents over MCP and report their exact tool lists - a judge-facing artifact.
Requires the compose stack to be up (see README "Run the tests").
"""
import httpx
import pytest

pytestmark = pytest.mark.integration

SERVICES = {
    "orchestrator": 8000, "producer-agent": 8001, "scout-agent": 8002,
    "negotiation-agent": 8003, "compliance-agent": 8004, "recovery-agent": 8005,
    "vendor-mock-1": 9001, "vendor-mock-2": 9002, "vendor-mock-3": 9003,
}


@pytest.mark.parametrize("name,port", SERVICES.items())
async def test_service_is_healthy(name, port):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"http://localhost:{port}/healthz")
    assert response.status_code == 200, name
    assert response.json()["ok"] is True


async def test_orchestrator_reports_every_agents_tools():
    async with httpx.AsyncClient(timeout=30) as client:
        agents = (await client.get("http://localhost:8000/healthz")).json()["agents"]
    assert agents["producer"] == ["decompose_brief"]
    assert agents["scout"] == ["find_vendors"]
    assert agents["negotiation"] == ["negotiate"]
    assert sorted(agents["compliance"]) == ["check_compliance", "request_approval"]
    # resolve_recovery was added with the C1 fix: a producer decision on a recovery
    # approval is routed back to the agent that owns recovery_events, rather than
    # into the happy-path resume (which left the event awaiting_approval forever).
    assert sorted(agents["recovery"]) == ["recover", "resolve_recovery"]
