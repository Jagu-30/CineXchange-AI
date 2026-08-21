from datetime import datetime, timezone
import uuid
from typing import Any, Dict, Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from backend.app.config import settings
from backend.app.agents.common.schemas import (
    APIResponseEnvelope,
    ProjectInput,
    Incident,
    ProductionState
)
from backend.app.api.models import (
    CreatePlanRequest,
    StartNegotiationRequest,
    CounterOfferApiRequest,
    CreateIncidentApiRequest,
    ApproveRecoveryApiRequest,
    ProducerApprovalApiRequest
)
from backend.app.dependencies import get_workflow, get_state_manager
from backend.app.orchestration.workflow import ProductionWorkflow
from backend.app.agents.common.state import StateManager
from backend.app.integrations.mcp_server import mcp_server
from backend.app.integrations.grafana_client import grafana_client
from backend.app.integrations.clickhouse_client import clickhouse_client

router = APIRouter()

def envelope(data: Any = None, errors: Optional[list] = None) -> APIResponseEnvelope:
    return APIResponseEnvelope(
        success=len(errors or []) == 0,
        data=data,
        errors=errors or [],
        timestamp=datetime.now(timezone.utc).isoformat(),
        request_id=f"REQ-{uuid.uuid4().hex[:8].upper()}"
    )

# 0. Integrations Status
@router.get("/integrations/status", response_model=APIResponseEnvelope)
def get_integrations_status():
    try:
        grafana_st = grafana_client.get_status()
        clickhouse_st = clickhouse_client.get_status()
        agent_platform_st = {
            "mode": "GEMINI" if settings.USE_GEMINI else "MOCK_FALLBACK",
            "model": settings.GEMINI_MODEL,
            "status": "CONNECTED" if (settings.USE_GEMINI and settings.GEMINI_API_KEY) else "ACTIVE_LOCAL",
            "api_key_configured": bool(settings.GEMINI_API_KEY),
            "last_call": datetime.now(timezone.utc).isoformat()
        }
        return envelope(data={
            "grafana": grafana_st,
            "clickhouse": clickhouse_st,
            "agent_platform": agent_platform_st,
            "mock_mode": settings.USE_MOCK_BACKEND
        })
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 1. Project Plan & Requirement Extraction (Producer Agent)
@router.post("/projects/plan", response_model=APIResponseEnvelope)
def create_project_plan(
    req: CreatePlanRequest,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        project_input = ProjectInput(
            project_id=req.project_id,
            title=req.title,
            description=req.description,
            producer_request=req.producer_request,
            budget=req.budget,
            currency=req.currency,
            duration_days=req.duration_days,
            location=req.location
        )
        state = wf.plan_project(project_input)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 2. Get Project State
@router.get("/projects/{project_id}/state", response_model=APIResponseEnvelope)
def get_project_state(
    project_id: str,
    sm: StateManager = Depends(get_state_manager)
):
    state = sm.get_state(project_id)
    if not state:
        default_proj = ProjectInput(
            project_id=project_id,
            title="Rainforest Night Shoot",
            description="Two low-light rainforest scenes over three days.",
            producer_request="We need to shoot two low-light rainforest scenes over three days within ₹25 lakh.",
            budget=2500000.0,
            currency="INR",
            duration_days=3,
            location="Western Ghats rainforest"
        )
        state = sm.create_or_update_project(default_proj)
    return envelope(data=state.model_dump())

# 3. Marketplace Scout (Scout Agent)
@router.post("/projects/{project_id}/scout", response_model=APIResponseEnvelope)
def run_scout(
    project_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.run_scout(project_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 4. Start Negotiation
@router.post("/projects/{project_id}/negotiations", response_model=APIResponseEnvelope)
def start_negotiation(
    project_id: str,
    req: StartNegotiationRequest,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.start_negotiation(project_id, req.vendor_id, req.resource_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 5. Submit Counter Offer
@router.post("/projects/{project_id}/negotiations/{negotiation_id}/counter", response_model=APIResponseEnvelope)
def submit_counter_offer(
    project_id: str,
    negotiation_id: str,
    req: CounterOfferApiRequest,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.counter_negotiation(
            project_id=project_id,
            negotiation_id=negotiation_id,
            counter_price=req.price,
            requested_terms=req.requested_terms
        )
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 6. Accept Negotiated Offer
@router.post("/projects/{project_id}/negotiations/{negotiation_id}/accept", response_model=APIResponseEnvelope)
def accept_negotiation(
    project_id: str,
    negotiation_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.accept_negotiation(project_id, negotiation_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 7. Compliance Verification (Compliance Agent)
@router.post("/projects/{project_id}/compliance", response_model=APIResponseEnvelope)
def run_compliance(
    project_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.run_compliance(project_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 8. Producer Approval / Reject
@router.post("/projects/{project_id}/approvals/{approval_id}/approve", response_model=APIResponseEnvelope)
def approve_decision(
    project_id: str,
    approval_id: str,
    req: ProducerApprovalApiRequest = ProducerApprovalApiRequest(),
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.record_approval(project_id, approval_id, approved=True, notes=req.notes or "")
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

@router.post("/projects/{project_id}/approvals/{approval_id}/reject", response_model=APIResponseEnvelope)
def reject_decision(
    project_id: str,
    approval_id: str,
    req: ProducerApprovalApiRequest = ProducerApprovalApiRequest(),
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.record_approval(project_id, approval_id, approved=False, notes=req.notes or "")
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 9. Trigger Emergency Incident
@router.post("/projects/{project_id}/incidents", response_model=APIResponseEnvelope)
def create_incident(
    project_id: str,
    req: CreateIncidentApiRequest,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        inc = Incident(
            incident_id=f"INC-{uuid.uuid4().hex[:6].upper()}",
            event=req.event,
            resource_id=req.resource_id,
            severity=req.severity,
            details=req.details
        )
        state = wf.trigger_incident(project_id, inc)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 10. Monitoring: Poll Grafana
@router.post("/projects/{project_id}/monitoring/poll", response_model=APIResponseEnvelope)
async def poll_monitoring(
    project_id: str
):
    try:
        incidents = await grafana_client.get_incidents(project_id)
        alerts = await grafana_client.get_alerts(project_id)
        metrics = await grafana_client.query_metrics("equipment_transit_delay_hours")
        return envelope(data={
            "incidents": [i.model_dump() for i in incidents],
            "alerts": alerts,
            "metrics": metrics,
            "status": "healthy"
        })
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 11. Run Emergency Recovery (Recovery Agent)
@router.post("/projects/{project_id}/recovery", response_model=APIResponseEnvelope)
def run_recovery(
    project_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.run_recovery(project_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 12. Approve Recovery Option
@router.post("/projects/{project_id}/recovery/approve", response_model=APIResponseEnvelope)
def approve_recovery(
    project_id: str,
    req: ApproveRecoveryApiRequest = ApproveRecoveryApiRequest(),
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.approve_recovery(project_id, req.recovery_option_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

@router.post("/projects/{project_id}/recovery/{recovery_id}/approve", response_model=APIResponseEnvelope)
def approve_recovery_by_id(
    project_id: str,
    recovery_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.approve_recovery(project_id, recovery_id)
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 12b. Create Booking
@router.post("/projects/{project_id}/bookings", response_model=APIResponseEnvelope)
def create_booking_endpoint(
    project_id: str,
    wf: ProductionWorkflow = Depends(get_workflow)
):
    try:
        state = wf.record_approval(project_id, "appr_auto", approved=True, notes="Simulated booking generated")
        return envelope(data=state.model_dump())
    except Exception as e:
        return envelope(data=None, errors=[str(e)])

# 13. Grafana endpoints
@router.get("/projects/{project_id}/grafana/incidents", response_model=APIResponseEnvelope)
async def get_grafana_incidents(project_id: str):
    try:
        incidents = await grafana_client.get_incidents(project_id)
        return envelope(data=[i.model_dump() for i in incidents])
    except Exception as e:
        return envelope(data=[], errors=[str(e)])

@router.get("/projects/{project_id}/grafana/alerts", response_model=APIResponseEnvelope)
async def get_grafana_alerts(project_id: str):
    try:
        alerts = await grafana_client.get_alerts(project_id)
        return envelope(data=alerts)
    except Exception as e:
        return envelope(data=[], errors=[str(e)])

@router.get("/projects/{project_id}/grafana/metrics", response_model=APIResponseEnvelope)
async def get_grafana_metrics(project_id: str):
    try:
        metrics = await grafana_client.query_metrics("equipment_transit_delay_hours")
        return envelope(data=metrics)
    except Exception as e:
        return envelope(data={}, errors=[str(e)])

# 14. ClickHouse Analytics endpoint
@router.get("/projects/{project_id}/analytics", response_model=APIResponseEnvelope)
async def get_project_analytics(project_id: str):
    try:
        neg_analytics = await clickhouse_client.get_negotiation_analytics(project_id)
        rec_analytics = await clickhouse_client.get_recovery_analytics(project_id)
        vendor_rel = await clickhouse_client.get_vendor_reliability("V003")
        price_history = await clickhouse_client.get_vendor_price_history("V003", "CAMERA")
        return envelope(data={
            "negotiation": neg_analytics,
            "recovery": rec_analytics,
            "vendor_reliability": vendor_rel,
            "price_history": price_history,
            "status": clickhouse_client.get_status()
        })
    except Exception as e:
        return envelope(data={}, errors=[str(e)])

# 15. Audit Log
@router.get("/projects/{project_id}/audit", response_model=APIResponseEnvelope)
def get_audit_log(
    project_id: str,
    sm: StateManager = Depends(get_state_manager)
):
    state = sm.get_state(project_id)
    if not state:
        return envelope(data=[], errors=[f"Project {project_id} not found"])
    return envelope(data=[a.model_dump() for a in state.audit_log])

# 16. MCP Server Routes
@router.get("/mcp/tools", response_model=APIResponseEnvelope)
def list_mcp_tools():
    tools = mcp_server.get_tool_definitions()
    return envelope(data=tools)

class MCPCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any]

@router.post("/mcp/call", response_model=APIResponseEnvelope)
def call_mcp_tool(req: MCPCallRequest):
    try:
        result = mcp_server.execute_tool(req.name, req.arguments)
        return envelope(data=result)
    except Exception as e:
        return envelope(data=None, errors=[str(e)])
