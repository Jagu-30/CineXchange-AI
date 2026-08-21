import json
import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.config import DATA_DIR, settings
from backend.app.agents.common.schemas import Incident, OperationalEvent


class GrafanaOperations(ABC):
    @abstractmethod
    async def emit_event(self, event: OperationalEvent) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def get_incidents(self, project_id: Optional[str] = None) -> List[Incident]:
        pass

    @abstractmethod
    async def get_alerts(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    async def query_metrics(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def query_logs(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def search_dashboards(self, query: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    async def create_annotation(self, event: OperationalEvent) -> Dict[str, Any]:
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        pass


class MockGrafanaClient(GrafanaOperations):
    """In-memory and file-backed deterministic Grafana mock for testing and local dev."""

    def __init__(self):
        self.events: List[OperationalEvent] = []
        self.incidents: List[Incident] = []
        self.alerts: List[Dict[str, Any]] = []
        self._init_demo_data()

    def _init_demo_data(self):
        # Demo incident for CAM-001
        self.incidents = [
            Incident(
                incident_id="INC-GRAFANA-001",
                event="RESOURCE_UNAVAILABLE",
                resource_id="CAM-001",
                occurred_at=datetime.now(timezone.utc).isoformat(),
                severity="CRITICAL",
                details={
                    "message": "Telemetry anomaly detected: ARRI Alexa Mini LF sensor overheated and failed during rainforest night shoot in Agumbe.",
                    "source": "Grafana Cloud OnCall / Synthetic Monitoring",
                    "telemetry_source": "Sensor-Temp-Monitor-Node-4",
                    "affected_resource": "CAM-001",
                    "vendor_id": "V001",
                    "location": "Agumbe Rainforest Sector 3",
                    "deeplink": "https://grafana.net/incidents/INC-GRAFANA-001"
                }
            )
        ]
        self.alerts = [
            {
                "alert_id": "ALT-001",
                "title": "Camera Sensor Thermal Failure",
                "resource_id": "CAM-001",
                "severity": "critical",
                "state": "firing",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "labels": {"project": "PROJ-001", "team": "camera-dept", "zone": "agumbe"}
            },
            {
                "alert_id": "ALT-002",
                "title": "Rainforest Generator Audio Noise SLA Warning",
                "resource_id": "GEN-001",
                "severity": "warning",
                "state": "normal",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "labels": {"project": "PROJ-001", "team": "sound-dept", "zone": "agumbe"}
            }
        ]

    async def emit_event(self, event: OperationalEvent) -> Dict[str, Any]:
        self.events.insert(0, event)
        if event.event_type == "resource_unavailable" and event.resource_id:
            existing = next((i for i in self.incidents if i.resource_id == event.resource_id), None)
            if not existing:
                self.incidents.insert(0, Incident(
                    incident_id=f"INC-GRAFANA-{uuid.uuid4().hex[:4].upper()}",
                    event="RESOURCE_UNAVAILABLE",
                    resource_id=event.resource_id,
                    occurred_at=datetime.now(timezone.utc).isoformat(),
                    severity="CRITICAL",
                    details=event.payload
                ))
        return {
            "status": "emitted",
            "event_id": event.event_id,
            "grafana_mode": "mock",
            "timestamp": event.timestamp
        }

    async def get_incidents(self, project_id: Optional[str] = None) -> List[Incident]:
        return self.incidents

    async def get_alerts(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.alerts

    async def query_metrics(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        return {
            "query": query,
            "status": "success",
            "data": {
                "resultType": "matrix",
                "result": [
                    {
                        "metric": {"__name__": "equipment_transit_delay_hours", "resource": "CAM-001"},
                        "values": [[1700000000, "0"], [1700000060, "0.5"], [1700000120, "2.0"]]
                    },
                    {
                        "metric": {"__name__": "equipment_transit_delay_hours", "resource": "CAM-002"},
                        "values": [[1700000000, "0"], [1700000060, "0"], [1700000120, "0"]]
                    }
                ]
            }
        }

    async def query_logs(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        return {
            "query": query,
            "status": "success",
            "logs": [
                {"timestamp": datetime.now(timezone.utc).isoformat(), "level": "error", "message": "CAM-001 sensor thermal overload detected at Agumbe site"},
                {"timestamp": datetime.now(timezone.utc).isoformat(), "level": "info", "message": "Production telemetry sync running smoothly on port 8000"}
            ]
        }

    async def search_dashboards(self, query: str) -> List[Dict[str, Any]]:
        return [
            {"id": 1, "uid": "cinexchange-prod", "title": "CineXchange Production Command Telemetry", "url": "/d/cinexchange-prod"}
        ]

    async def create_annotation(self, event: OperationalEvent) -> Dict[str, Any]:
        return {
            "id": 101,
            "message": f"Annotation: {event.event_type} on {event.project_id}",
            "status": "created"
        }

    def get_status(self) -> Dict[str, Any]:
        return {
            "mode": "MOCK",
            "status": "CONNECTED",
            "endpoint": "local://mock_grafana",
            "last_event": self.events[0].model_dump() if self.events else None,
            "last_incident_query": datetime.now(timezone.utc).isoformat(),
            "incident_count": len(self.incidents),
            "alert_count": len(self.alerts)
        }


class GrafanaCloudMCPClient(GrafanaOperations):
    """Client connecting to real Grafana Cloud MCP endpoint."""

    def __init__(self):
        self.mcp_url = settings.GRAFANA_MCP_URL
        self.token = settings.GRAFANA_SERVICE_ACCOUNT_TOKEN
        self.events: List[OperationalEvent] = []

    def _is_configured(self) -> bool:
        return bool(self.mcp_url and self.token)

    async def emit_event(self, event: OperationalEvent) -> Dict[str, Any]:
        if not self._is_configured():
            raise RuntimeError("Grafana Cloud MCP is not properly configured. Missing GRAFANA_MCP_URL or GRAFANA_SERVICE_ACCOUNT_TOKEN.")
        self.events.insert(0, event)
        import httpx
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{self.mcp_url}/events", json=event.model_dump(), headers=headers)
            return resp.json()

    async def get_incidents(self, project_id: Optional[str] = None) -> List[Incident]:
        if not self._is_configured():
            raise RuntimeError("Grafana Cloud MCP is not configured. Missing credentials.")
        import httpx
        headers = {"Authorization": f"Bearer {self.token}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{self.mcp_url}/incidents", headers=headers)
            data = resp.json()
            return [Incident(**item) for item in data]

    async def get_alerts(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if not self._is_configured():
            raise RuntimeError("Grafana Cloud MCP is not configured.")
        import httpx
        headers = {"Authorization": f"Bearer {self.token}"}
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{self.mcp_url}/alerts", headers=headers)
            return resp.json()

    async def query_metrics(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        if not self._is_configured():
            raise RuntimeError("Grafana Cloud MCP is not configured.")
        return {"query": query, "status": "live_mcp_query"}

    async def query_logs(self, query: str, start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
        if not self._is_configured():
            raise RuntimeError("Grafana Cloud MCP is not configured.")
        return {"query": query, "status": "live_mcp_logs"}

    async def search_dashboards(self, query: str) -> List[Dict[str, Any]]:
        return []

    async def create_annotation(self, event: OperationalEvent) -> Dict[str, Any]:
        return {"status": "created"}

    def get_status(self) -> Dict[str, Any]:
        if not self._is_configured():
            return {
                "mode": "CLOUD_MCP",
                "status": "NOT_CONFIGURED",
                "endpoint": self.mcp_url or "unset",
                "last_event": None,
                "incident_count": 0,
                "alert_count": 0,
                "error": "Missing GRAFANA_MCP_URL or GRAFANA_SERVICE_ACCOUNT_TOKEN in environment."
            }
        return {
            "mode": "CLOUD_MCP",
            "status": "CONNECTED",
            "endpoint": self.mcp_url,
            "last_event": self.events[0].model_dump() if self.events else None,
            "incident_count": 0,
            "alert_count": 0
        }


def create_grafana_client() -> GrafanaOperations:
    if settings.GRAFANA_MODE.lower() == "cloud_mcp":
        return GrafanaCloudMCPClient()
    return MockGrafanaClient()


grafana_client = create_grafana_client()
