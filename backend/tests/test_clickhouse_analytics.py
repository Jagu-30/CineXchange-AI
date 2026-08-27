import pytest
import asyncio
from backend.app.agents.common.schemas import OperationalEvent
from backend.app.integrations.clickhouse_client import (
    MockClickHouseClient,
    ClickHouseCloudClient,
    clickhouse_client,
    PRODUCTION_EVENTS_SCHEMA
)


@pytest.mark.asyncio
async def test_mock_clickhouse_client_schema_and_event_insertion():
    """Test MockClickHouseClient schema, event insertion, and status."""
    client = MockClickHouseClient()

    # 1. Schema check
    assert "CREATE TABLE IF NOT EXISTS cinexchange.production_events" in PRODUCTION_EVENTS_SCHEMA
    assert "event_id" in PRODUCTION_EVENTS_SCHEMA
    assert "project_id" in PRODUCTION_EVENTS_SCHEMA
    assert "trace_id" in PRODUCTION_EVENTS_SCHEMA
    assert client.table_name == "production_events"

    # 2. Event insertion
    initial_count = len(client.events)
    test_event = OperationalEvent(
        event_type="test_telemetry_event",
        project_id="PROJ-CH-TEST",
        resource_id="CAM-001",
        vendor_id="V003",
        severity="INFO",
        payload={"discount_received": 8.0, "stage": "negotiation"},
        trace_id="trace-test-123"
    )
    await client.insert_event(test_event)
    assert len(client.events) == initial_count + 1
    assert client.events[0].event_id == test_event.event_id

    # 3. Status check
    status = client.get_status()
    assert status["mode"] == "MOCK"
    assert status["status"] == "CONNECTED"
    assert status["table"] == "production_events"
    assert status["analytics_available"] is True
    assert status["events_stored"] >= 1


@pytest.mark.asyncio
async def test_clickhouse_vendor_price_history():
    """Test retrieving vendor historical price quotes and discounts."""
    client = MockClickHouseClient()
    history = await client.get_vendor_price_history("V003", "CAMERA")

    assert len(history) >= 2
    assert all("date" in item and "price" in item for item in history)
    assert any(item["vendor_id"] == "V003" for item in history)
    assert all(item["price"] > 0 for item in history)


@pytest.mark.asyncio
async def test_clickhouse_negotiation_savings_analytics():
    """Test ClickHouse negotiation analytics calculations (savings %, rounds, value saved)."""
    client = MockClickHouseClient()
    analytics = await client.get_negotiation_analytics("PROJ-001")

    assert "average_negotiated_savings_pct" in analytics
    assert analytics["average_negotiated_savings_pct"] >= 8.0
    assert "average_rounds_to_close" in analytics
    assert analytics["average_rounds_to_close"] <= 3.0
    assert "total_negotiations" in analytics
    assert analytics["total_negotiations"] >= 1
    assert "total_value_saved_inr" in analytics
    assert analytics["total_value_saved_inr"] > 0


@pytest.mark.asyncio
async def test_clickhouse_recovery_analytics():
    """Test ClickHouse emergency recovery metrics (cost delta, delay, resolution time)."""
    client = MockClickHouseClient()
    analytics = await client.get_recovery_analytics("PROJ-001")

    assert "recovery_incident_count" in analytics
    assert analytics["recovery_incident_count"] >= 1
    assert "average_recovery_cost_delta_inr" in analytics
    assert analytics["average_recovery_cost_delta_inr"] == 8000.0
    assert "average_schedule_delay_days" in analytics
    assert analytics["average_schedule_delay_days"] == 0.0
    assert "top_recovered_resource_type" in analytics
    assert analytics["top_recovered_resource_type"] == "CAMERA"


@pytest.mark.asyncio
async def test_clickhouse_vendor_reliability():
    """Test ClickHouse vendor reliability benchmarking."""
    client = MockClickHouseClient()
    rel = await client.get_vendor_reliability("V003")

    assert rel["vendor_id"] == "V003"
    assert rel["on_time_delivery_rate_pct"] >= 95.0
    assert rel["equipment_uptime_pct"] >= 95.0
    assert rel["insurance_compliance_score"] == 100.0
    assert rel["historical_projects_completed"] >= 10
    assert rel["average_rating"] >= 4.0


@pytest.mark.asyncio
async def test_clickhouse_cloud_client_adapter():
    """Test ClickHouseCloudClient configuration handling and error behavior."""
    cloud_client = ClickHouseCloudClient()
    status = cloud_client.get_status()

    assert status["mode"] == "CLOUD"
    assert status["status"] in ["CONNECTED", "NOT_CONFIGURED"]

    if status["status"] == "NOT_CONFIGURED":
        with pytest.raises(RuntimeError) as exc_info:
            await cloud_client.insert_event(
                OperationalEvent(
                    event_type="test",
                    project_id="PROJ-001",
                    payload={}
                )
            )
        assert "not configured" in str(exc_info.value).lower()
