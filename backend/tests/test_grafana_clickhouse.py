import pytest
import asyncio
from backend.app.agents.common.schemas import OperationalEvent, Incident, ProjectInput
from backend.app.integrations.grafana_client import (
    MockGrafanaClient,
    GrafanaCloudMCPClient,
    grafana_client
)
from backend.app.integrations.clickhouse_client import clickhouse_client
from backend.app.orchestration.workflow import ProductionWorkflow


@pytest.mark.asyncio
async def test_grafana_mock_operations_and_incident_retrieval():
    """Test MockGrafanaClient operations: emit_event, get_incidents, get_alerts, query_metrics, query_logs, create_annotation."""
    client = MockGrafanaClient()

    # 1. Emit operational event
    event = OperationalEvent(
        event_type="resource_search_completed",
        project_id="PROJ-GRAF-001",
        resource_id="CAM-001",
        payload={"candidates_count": 5}
    )
    emit_res = await client.emit_event(event)
    assert emit_res["status"] == "emitted"
    assert len(client.events) >= 1

    # 2. Get incidents
    incidents = await client.get_incidents("PROJ-GRAF-001")
    assert len(incidents) >= 1
    inc_001 = next((i for i in incidents if i.resource_id == "CAM-001"), None)
    assert inc_001 is not None
    assert inc_001.incident_id == "INC-GRAFANA-001"
    assert inc_001.severity == "CRITICAL"

    # 3. Get alerts
    alerts = await client.get_alerts("PROJ-GRAF-001")
    assert len(alerts) >= 1
    assert any(a["resource_id"] == "CAM-001" for a in alerts)

    # 4. Query metrics
    metrics = await client.query_metrics("equipment_transit_delay_hours")
    assert metrics["status"] == "success"
    assert "data" in metrics

    # 5. Query logs
    logs = await client.query_logs("level=error")
    assert logs["status"] == "success"
    assert len(logs["logs"]) >= 1

    # 6. Create annotation
    ann = await client.create_annotation(event)
    assert ann["status"] == "created"

    # 7. Check integration status
    status = client.get_status()
    assert status["mode"] == "MOCK"
    assert status["status"] == "CONNECTED"
    assert status["incident_count"] >= 1


@pytest.mark.asyncio
async def test_grafana_cloud_mcp_client_adapter():
    """Test GrafanaCloudMCPClient adapter initialization and unconfigured behavior."""
    cloud_client = GrafanaCloudMCPClient()
    status = cloud_client.get_status()
    assert status["mode"] == "CLOUD_MCP"
    # When credentials are not set in test environment, status must be NOT_CONFIGURED
    assert status["status"] in ["CONNECTED", "NOT_CONFIGURED"]

    if status["status"] == "NOT_CONFIGURED":
        with pytest.raises(RuntimeError) as exc_info:
            await cloud_client.get_incidents()
        assert "not configured" in str(exc_info.value).lower()


def test_recovery_agent_queries_grafana_and_stores_incident_id():
    """Test that Recovery Agent queries Grafana get_incidents and stores the Grafana incident ID in ProductionState."""
    wf = ProductionWorkflow()
    project = ProjectInput(
        project_id="PROJ-GRAFANA-E2E",
        title="Agumbe Night Shoot",
        producer_request="Night shoot in Western Ghats rainforest with low-light camera",
        budget=2500000.0,
        currency="INR",
        duration_days=3,
        location="Western Ghats (Agumbe)"
    )
    # 1. Plan project & scout
    state = wf.plan_project(project)
    state = wf.run_scout("PROJ-GRAFANA-E2E")

    # 2. Run recovery (queries grafana_client.get_incidents() internally)
    state = wf.run_recovery("PROJ-GRAFANA-E2E")

    # 3. Verify incident ID is stored in ProductionState
    assert len(state.incidents) >= 1
    assert state.incidents[0].incident_id == "INC-GRAFANA-001"
    assert state.incidents[0].resource_id == "CAM-001"

    # 4. Verify recovery options are generated with zero delay for CAM-002
    assert len(state.recovery_options) >= 1
    top_option = state.recovery_options[0]
    assert top_option.candidate.resource_id == "CAM-002"
    assert top_option.cost_delta == 8000.0
    assert top_option.schedule_delay_days == 0
    assert top_option.candidate.distance_km == 12.0
    assert top_option.candidate.available is True


@pytest.mark.asyncio
async def test_clickhouse_mock_stores_events_and_returns_analytics():
    """Test ClickHouse mock analytics and event pipeline."""
    event = OperationalEvent(
        event_type="test_analytics_event",
        project_id="PROJ-TEST",
        payload={"val": 100}
    )
    await clickhouse_client.insert_event(event)

    neg_analytics = await clickhouse_client.get_negotiation_analytics("PROJ-TEST")
    assert "average_negotiated_savings_pct" in neg_analytics
    assert neg_analytics["average_negotiated_savings_pct"] >= 8.0

    rec_analytics = await clickhouse_client.get_recovery_analytics("PROJ-TEST")
    assert "average_recovery_cost_delta_inr" in rec_analytics
    assert rec_analytics["average_schedule_delay_days"] == 0.0

    status = clickhouse_client.get_status()
    assert status["mode"] in ["MOCK", "CLOUD"]
    assert status["analytics_available"] is True
