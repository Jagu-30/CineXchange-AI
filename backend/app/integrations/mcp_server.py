"""Model Context Protocol (MCP) Server for CineXchange AI.
Exposes tools for LLM agent function calling over standard MCP protocol.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import asyncio

from backend.app.agents.producer.agent import ProducerAgent
from backend.app.agents.scout.agent import MarketplaceScoutAgent
from backend.app.agents.negotiation.agent import NegotiationAgent
from backend.app.agents.compliance.agent import ComplianceApprovalAgent
from backend.app.agents.recovery.agent import EmergencyRecoveryAgent
from backend.app.agents.common.schemas import ProjectInput, Incident, CounterOfferInput, NegotiationState, BookingRecord
from backend.app.integrations.grafana_client import grafana_client
from backend.app.integrations.clickhouse_client import clickhouse_client
from backend.app.integrations.backend_client import backend_client

# Tool input models
class SearchResourcesInput(BaseModel):
    category: Optional[str] = Field(default=None, description="Category filter (EQUIPMENT, CREW, LOGISTICS, COMPLIANCE)")
    resource_type: Optional[str] = Field(default=None, description="Resource type filter (CAMERA, LIGHTING, etc.)")

class CheckAvailabilityInput(BaseModel):
    resource_id: str = Field(description="Target resource identifier")
    start_date: str = Field(default="2026-08-20", description="Shoot start date")
    duration_days: int = Field(default=3, description="Duration in days")

class GetVendorDetailsInput(BaseModel):
    vendor_id: str = Field(description="Vendor identifier (e.g. V001, V003)")

class GetQuoteInput(BaseModel):
    vendor_id: str
    resource_id: str
    initial_price: Optional[float] = 480000.0

class SubmitCounterOfferInput(BaseModel):
    negotiation_id: str
    vendor_id: str
    resource_id: str
    initial_price: float
    current_price: float
    rounds: int
    target_savings_percent: float = 8.0
    counter_price: Optional[float] = None
    requested_terms: Optional[Dict[str, Any]] = None

class AcceptOfferInput(BaseModel):
    negotiation_id: str
    vendor_id: str
    resource_id: str
    agreed_price: float

class VerifyDocumentInput(BaseModel):
    document_id: str
    vendor_id: Optional[str] = None

class CheckComplianceInput(BaseModel):
    vendor_id: str = "V003"
    deal_amount: float = 1449000.0

class BookingInput(BaseModel):
    project_id: str
    resource_id: str
    vendor_id: str
    agreed_price: float
    booking_id: Optional[str] = None
    start_date: str = "2026-08-20"
    duration_days: int = 3

class CalculateRecoveryOptionsInput(BaseModel):
    incident_id: str = "INC-001"
    failed_resource_id: str = "CAM-001"
    original_price: float = 480000.0
    details: Optional[Dict[str, Any]] = None

class GrafanaQueryInput(BaseModel):
    project_id: Optional[str] = None
    query: Optional[str] = "equipment_transit_delay_hours"

class AnalyticsQueryInput(BaseModel):
    project_id: Optional[str] = None
    vendor_id: Optional[str] = "V003"
    resource_type: Optional[str] = "CAMERA"

class CineXchangeMCPServer:
    """MCP Tool registry and execution handler."""

    def __init__(self):
        self.producer = ProducerAgent()
        self.scout = MarketplaceScoutAgent()
        self.negotiation = NegotiationAgent()
        self.compliance = ComplianceApprovalAgent()
        self.recovery = EmergencyRecoveryAgent()

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        return [
            # Marketplace
            {
                "name": "search_resources",
                "description": "Search available cinema equipment, crew, logistics, and compliance packages.",
                "parameters": SearchResourcesInput.model_json_schema()
            },
            {
                "name": "check_availability",
                "description": "Check if a specific resource is available for requested shoot dates.",
                "parameters": CheckAvailabilityInput.model_json_schema()
            },
            {
                "name": "get_vendor_details",
                "description": "Retrieve full profile, rating, and reliability score for a vendor.",
                "parameters": GetVendorDetailsInput.model_json_schema()
            },
            # Negotiation
            {
                "name": "get_quote",
                "description": "Fetch formal quote and service terms from a vendor.",
                "parameters": GetQuoteInput.model_json_schema()
            },
            {
                "name": "submit_counter_offer",
                "description": "Submit a structured counter-offer to a vendor and simulate their response.",
                "parameters": SubmitCounterOfferInput.model_json_schema()
            },
            {
                "name": "get_vendor_response",
                "description": "Evaluate vendor response to counter-offer under deterministic negotiation policies.",
                "parameters": SubmitCounterOfferInput.model_json_schema()
            },
            {
                "name": "accept_offer",
                "description": "Formally accept negotiated vendor package.",
                "parameters": AcceptOfferInput.model_json_schema()
            },
            # Compliance
            {
                "name": "verify_insurance",
                "description": "Verify insurance policy coverage amount, validity dates, and active status.",
                "parameters": VerifyDocumentInput.model_json_schema()
            },
            {
                "name": "verify_permit",
                "description": "Verify local film shooting permit validity and authority approvals.",
                "parameters": VerifyDocumentInput.model_json_schema()
            },
            {
                "name": "analyze_contract",
                "description": "Analyze equipment rental contract terms and legal clause compliance.",
                "parameters": VerifyDocumentInput.model_json_schema()
            },
            {
                "name": "check_compliance",
                "description": "Evaluate 5-dimension risk matrix and producer approval conditions for a deal.",
                "parameters": CheckComplianceInput.model_json_schema()
            },
            # Booking
            {
                "name": "create_booking",
                "description": "Create simulated booking record with agreed vendor and resource parameters.",
                "parameters": BookingInput.model_json_schema()
            },
            {
                "name": "update_booking",
                "description": "Update an existing booking with a replaced resource after emergency recovery.",
                "parameters": BookingInput.model_json_schema()
            },
            {
                "name": "cancel_booking",
                "description": "Cancel an existing simulated booking due to incident or failure.",
                "parameters": BookingInput.model_json_schema()
            },
            # Grafana
            {
                "name": "get_incidents",
                "description": "Fetch active Grafana Cloud MCP incidents for telemetry and monitoring.",
                "parameters": GrafanaQueryInput.model_json_schema()
            },
            {
                "name": "get_alerts",
                "description": "Query live Grafana operational firing alerts.",
                "parameters": GrafanaQueryInput.model_json_schema()
            },
            {
                "name": "query_metrics",
                "description": "Query Grafana metrics such as equipment transit delay or telemetry temperatures.",
                "parameters": GrafanaQueryInput.model_json_schema()
            },
            {
                "name": "query_logs",
                "description": "Query Grafana operational logs for telemetry anomaly messages.",
                "parameters": GrafanaQueryInput.model_json_schema()
            },
            {
                "name": "search_dashboards",
                "description": "Search Grafana production dashboards.",
                "parameters": GrafanaQueryInput.model_json_schema()
            },
            # Analytics
            {
                "name": "get_vendor_price_history",
                "description": "Fetch historical ClickHouse vendor price trends and discount rates.",
                "parameters": AnalyticsQueryInput.model_json_schema()
            },
            {
                "name": "get_negotiation_analytics",
                "description": "Fetch historical ClickHouse negotiation savings and rounds analytics.",
                "parameters": AnalyticsQueryInput.model_json_schema()
            },
            {
                "name": "get_recovery_analytics",
                "description": "Fetch historical ClickHouse equipment recovery cost and delay metrics.",
                "parameters": AnalyticsQueryInput.model_json_schema()
            },
            # Recovery
            {
                "name": "calculate_recovery_options",
                "description": "Find and rank alternative replacement options when equipment fails mid-shoot.",
                "parameters": CalculateRecoveryOptionsInput.model_json_schema()
            }
        ]

    def execute_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Executes tool by name with validated Pydantic arguments."""
        if name == "search_resources":
            args = SearchResourcesInput(**arguments)
            results = self.scout.search_resources(category=args.category, resource_type=args.resource_type)
            return {"results": [r.model_dump() for r in results]}

        elif name == "check_availability":
            args = CheckAvailabilityInput(**arguments)
            avail = self.scout.check_availability(args.resource_id, args.start_date, args.duration_days)
            return {"resource_id": args.resource_id, "available": avail}

        elif name == "get_vendor_details":
            args = GetVendorDetailsInput(**arguments)
            v = self.scout.get_vendor_details(args.vendor_id)
            return {"vendor": v}

        elif name == "get_quote":
            args = GetQuoteInput(**arguments)
            q = self.negotiation.get_quote(args.vendor_id, args.resource_id, args.initial_price or 480000.0)
            return {"quote": q.model_dump()}

        elif name in ("submit_counter_offer", "get_vendor_response"):
            args = SubmitCounterOfferInput(**arguments)
            neg_state = NegotiationState(
                negotiation_id=args.negotiation_id,
                vendor_id=args.vendor_id,
                resource_id=args.resource_id,
                initial_price=args.initial_price,
                current_price=args.current_price,
                target_price=round(args.initial_price * (1.0 - (args.target_savings_percent / 100.0)), -2),
                minimum_price=round(args.initial_price * 0.90, -2),
                rounds=args.rounds,
                target_savings_percent=args.target_savings_percent
            )
            resp, audit = self.negotiation.submit_counter_offer(
                neg_state, args.counter_price, args.requested_terms
            )
            return {"response": resp.model_dump(), "audit": audit.model_dump()}

        elif name == "accept_offer":
            args = AcceptOfferInput(**arguments)
            neg_state = NegotiationState(
                negotiation_id=args.negotiation_id,
                vendor_id=args.vendor_id,
                resource_id=args.resource_id,
                initial_price=args.agreed_price,
                current_price=args.agreed_price,
                target_price=args.agreed_price,
                minimum_price=args.agreed_price * 0.9,
                rounds=1
            )
            updated, audit = self.negotiation.accept_offer(neg_state)
            return {"negotiation": updated.model_dump(), "audit": audit.model_dump()}

        elif name in ("verify_insurance", "verify_permit", "analyze_contract", "extract_document"):
            args = VerifyDocumentInput(**arguments)
            doc = self.compliance.extract_document(args.document_id)
            return {"document": doc.model_dump() if doc else None, "verified": bool(doc and doc.status == "VALID")}

        elif name == "check_compliance":
            args = CheckComplianceInput(**arguments)
            res, audit = self.compliance.check_compliance(vendor_id=args.vendor_id, deal_amount=args.deal_amount)
            return {"result": res.model_dump(), "audit": audit.model_dump()}

        elif name == "create_booking":
            args = BookingInput(**arguments)
            booking = BookingRecord(
                booking_id=args.booking_id or f"BKG-{args.project_id}-001",
                resource_id=args.resource_id,
                resource_name=f"Resource {args.resource_id}",
                vendor_id=args.vendor_id,
                vendor_name=f"Vendor {args.vendor_id}",
                price=args.agreed_price,
                status="CONFIRMED",
                delivery_date=args.start_date,
                insurance_covered=True
            )
            return {"booking": booking.model_dump(), "simulated": True}

        elif name == "update_booking":
            args = BookingInput(**arguments)
            booking = BookingRecord(
                booking_id=args.booking_id or f"BKG-UPDATED-{args.project_id}",
                resource_id=args.resource_id,
                resource_name=f"Replaced Resource {args.resource_id}",
                vendor_id=args.vendor_id,
                vendor_name=f"Vendor {args.vendor_id}",
                price=args.agreed_price,
                status="CONFIRMED",
                delivery_date="Immediate Dispatch",
                insurance_covered=True
            )
            return {"booking": booking.model_dump(), "simulated": True}

        elif name == "cancel_booking":
            args = BookingInput(**arguments)
            return {"booking_id": args.booking_id, "status": "CANCELLED", "simulated": True}

        elif name == "calculate_recovery_options":
            args = CalculateRecoveryOptionsInput(**arguments)
            inc = Incident(
                incident_id=args.incident_id,
                resource_id=args.failed_resource_id,
                details=args.details or {}
            )
            res, audit = self.recovery.calculate_recovery_options(incident=inc, original_price=args.original_price)
            return {"recovery_plan": res.model_dump(), "audit": audit.model_dump()}

        elif name == "get_incidents":
            args = GrafanaQueryInput(**arguments)
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    incidents = asyncio.run_coroutine_threadsafe(grafana_client.get_incidents(args.project_id), loop).result(timeout=3.0)
                else:
                    incidents = loop.run_until_complete(grafana_client.get_incidents(args.project_id))
            except Exception:
                incidents = asyncio.run(grafana_client.get_incidents(args.project_id))
            return {"incidents": [i.model_dump() for i in incidents]}

        elif name == "get_alerts":
            args = GrafanaQueryInput(**arguments)
            try:
                alerts = asyncio.run(grafana_client.get_alerts(args.project_id))
            except Exception:
                alerts = []
            return {"alerts": alerts}

        elif name == "query_metrics":
            args = GrafanaQueryInput(**arguments)
            try:
                metrics = asyncio.run(grafana_client.query_metrics(args.query or "equipment_transit_delay_hours"))
            except Exception:
                metrics = {}
            return {"metrics": metrics}

        elif name == "query_logs":
            args = GrafanaQueryInput(**arguments)
            try:
                logs = asyncio.run(grafana_client.query_logs(args.query or "error"))
            except Exception:
                logs = {}
            return {"logs": logs}

        elif name == "search_dashboards":
            args = GrafanaQueryInput(**arguments)
            try:
                dashboards = asyncio.run(grafana_client.search_dashboards(args.query or "cinexchange"))
            except Exception:
                dashboards = []
            return {"dashboards": dashboards}

        elif name == "get_vendor_price_history":
            args = AnalyticsQueryInput(**arguments)
            try:
                history = asyncio.run(clickhouse_client.get_vendor_price_history(args.vendor_id or "V003", args.resource_type or "CAMERA"))
            except Exception:
                history = []
            return {"price_history": history}

        elif name == "get_negotiation_analytics":
            args = AnalyticsQueryInput(**arguments)
            try:
                analytics = asyncio.run(clickhouse_client.get_negotiation_analytics(args.project_id))
            except Exception:
                analytics = {}
            return {"analytics": analytics}

        elif name == "get_recovery_analytics":
            args = AnalyticsQueryInput(**arguments)
            try:
                analytics = asyncio.run(clickhouse_client.get_recovery_analytics(args.project_id))
            except Exception:
                analytics = {}
            return {"analytics": analytics}

        else:
            raise ValueError(f"Unknown MCP tool: {name}")

mcp_server = CineXchangeMCPServer()
