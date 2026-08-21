import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.app.agents.common.schemas import (
    ProductionState,
    ProjectInput,
    WorkflowState,
    Requirement,
    Incident,
    BookingRecord,
    AuditLogEntry,
    OperationalEvent
)
from backend.app.agents.common.exceptions import InvalidStateTransitionError
from backend.app.agents.common.state import state_manager
from backend.app.agents.producer.agent import ProducerAgent
from backend.app.agents.scout.agent import MarketplaceScoutAgent
from backend.app.agents.negotiation.agent import NegotiationAgent
from backend.app.agents.compliance.agent import ComplianceApprovalAgent
from backend.app.agents.recovery.agent import EmergencyRecoveryAgent
from backend.app.integrations.backend_client import backend_client
from backend.app.integrations.grafana_client import grafana_client
from backend.app.integrations.clickhouse_client import clickhouse_client

VALID_TRANSITIONS = {
    WorkflowState.DRAFT: [WorkflowState.REQUIREMENTS_EXTRACTED, WorkflowState.DRAFT],
    WorkflowState.REQUIREMENTS_EXTRACTED: [WorkflowState.SCOUTING, WorkflowState.CANDIDATES_READY, WorkflowState.DRAFT],
    WorkflowState.SCOUTING: [WorkflowState.CANDIDATES_READY, WorkflowState.SCOUTING],
    WorkflowState.CANDIDATES_READY: [WorkflowState.NEGOTIATION_IN_PROGRESS, WorkflowState.SCOUTING, WorkflowState.INCIDENT_DETECTED, WorkflowState.RECOVERY_IN_PROGRESS],
    WorkflowState.NEGOTIATION_IN_PROGRESS: [WorkflowState.QUOTE_READY, WorkflowState.COMPLIANCE_CHECKING, WorkflowState.NEGOTIATION_IN_PROGRESS],
    WorkflowState.QUOTE_READY: [WorkflowState.COMPLIANCE_CHECKING, WorkflowState.NEGOTIATION_IN_PROGRESS],
    WorkflowState.COMPLIANCE_CHECKING: [WorkflowState.APPROVAL_REQUIRED, WorkflowState.APPROVED, WorkflowState.BLOCKED],
    WorkflowState.APPROVAL_REQUIRED: [WorkflowState.APPROVED, WorkflowState.BLOCKED, WorkflowState.APPROVAL_REQUIRED],
    WorkflowState.APPROVED: [WorkflowState.BOOKED, WorkflowState.APPROVED],
    WorkflowState.BOOKED: [WorkflowState.INCIDENT_DETECTED, WorkflowState.RECOVERY_IN_PROGRESS, WorkflowState.COMPLETED, WorkflowState.BOOKED],
    WorkflowState.INCIDENT_DETECTED: [WorkflowState.RECOVERY_IN_PROGRESS, WorkflowState.RECOVERY_APPROVAL_REQUIRED, WorkflowState.INCIDENT_DETECTED],
    WorkflowState.RECOVERY_IN_PROGRESS: [WorkflowState.RECOVERY_APPROVAL_REQUIRED, WorkflowState.RECOVERY_APPROVED, WorkflowState.RECOVERY_IN_PROGRESS],
    WorkflowState.RECOVERY_APPROVAL_REQUIRED: [WorkflowState.RECOVERY_APPROVED, WorkflowState.BLOCKED, WorkflowState.RECOVERY_APPROVAL_REQUIRED],
    WorkflowState.RECOVERY_APPROVED: [WorkflowState.BOOKED, WorkflowState.COMPLETED],
    WorkflowState.BLOCKED: [WorkflowState.DRAFT, WorkflowState.SCOUTING, WorkflowState.COMPLIANCE_CHECKING],
    WorkflowState.COMPLETED: [WorkflowState.INCIDENT_DETECTED]
}

class ProductionWorkflow:
    """Orchestrates multi-agent production lifecycle from intake to booking and emergency recovery."""

    def __init__(self):
        self.producer = ProducerAgent()
        self.scout = MarketplaceScoutAgent()
        self.negotiation = NegotiationAgent()
        self.compliance = ComplianceApprovalAgent()
        self.recovery = EmergencyRecoveryAgent()

    def _emit_event_sync(self, event: OperationalEvent):
        """Helper to fire events to Grafana and ClickHouse concurrently."""
        async def _emit():
            await asyncio.gather(
                grafana_client.emit_event(event),
                clickhouse_client.insert_event(event),
                return_exceptions=True
            )
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_emit())
        except RuntimeError:
            try:
                asyncio.run(_emit())
            except Exception:
                pass

    def _transition(self, state: ProductionState, new_state: WorkflowState) -> None:
        allowed = VALID_TRANSITIONS.get(state.current_state, [])
        if new_state not in allowed and new_state != state.current_state:
            raise InvalidStateTransitionError(
                f"Cannot transition from {state.current_state.value} to {new_state.value}"
            )
        state.current_state = new_state

    # Stage 1: Plan project (Producer Agent)
    def plan_project(self, project: ProjectInput) -> ProductionState:
        state = state_manager.create_or_update_project(project)
        extraction, audit = self.producer.run(project)

        state.requirements = extraction.requirements
        state.audit_log.insert(0, audit)
        self._transition(state, WorkflowState.REQUIREMENTS_EXTRACTED)

        # Emit operational events
        self._emit_event_sync(OperationalEvent(
            event_type="project_created",
            project_id=project.project_id,
            agent_name="Producer Agent",
            payload={"title": project.title, "budget": project.budget, "duration_days": project.duration_days}
        ))
        self._emit_event_sync(OperationalEvent(
            event_type="requirements_extracted",
            project_id=project.project_id,
            agent_name="Producer Agent",
            payload={"requirements_count": len(state.requirements)}
        ))

        return state_manager.save_state(state)

    # Stage 2: Scout Marketplace (Scout Agent)
    def run_scout(self, project_id: str) -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        try:
            self._transition(state, WorkflowState.SCOUTING)
        except InvalidStateTransitionError:
            pass

        results, audit = self.scout.run(
            requirements=state.requirements,
            remaining_budget=state.project.budget
        )

        state.candidates = results.recommendations + results.rejected_candidates
        state.audit_log.insert(0, audit)
        self._transition(state, WorkflowState.CANDIDATES_READY)

        self._emit_event_sync(OperationalEvent(
            event_type="resource_search_completed",
            project_id=project_id,
            agent_name="Marketplace Scout Agent",
            payload={"total_candidates": len(state.candidates), "eligible_count": len(results.recommendations)}
        ))

        return state_manager.save_state(state)

    # Stage 3: Initiate and Run Negotiation
    def start_negotiation(self, project_id: str, vendor_id: str = "V003", resource_id: str = "CAM-002") -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        cand = next((c.candidate for c in state.candidates if c.candidate.resource_id == resource_id), None)
        initial_price = cand.price if cand else 480000.0

        neg_state, audit = self.negotiation.initialize_negotiation(
            vendor_id=vendor_id,
            resource_id=resource_id,
            initial_price=initial_price
        )

        state.negotiations = [n for n in state.negotiations if n.negotiation_id != neg_state.negotiation_id]
        state.negotiations.insert(0, neg_state)
        state.audit_log.insert(0, audit)

        try:
            self._transition(state, WorkflowState.NEGOTIATION_IN_PROGRESS)
        except InvalidStateTransitionError:
            pass

        self._emit_event_sync(OperationalEvent(
            event_type="quote_received",
            project_id=project_id,
            vendor_id=vendor_id,
            resource_id=resource_id,
            agent_name="Negotiation Agent",
            payload={"initial_price": initial_price}
        ))

        return state_manager.save_state(state)

    def counter_negotiation(
        self,
        project_id: str,
        negotiation_id: str,
        counter_price: Optional[float] = None,
        requested_terms: Optional[dict] = None
    ) -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        neg = next((n for n in state.negotiations if n.negotiation_id == negotiation_id), None)
        if not neg:
            raise ValueError(f"Negotiation {negotiation_id} not found")

        resp, audit = self.negotiation.submit_counter_offer(
            state=neg,
            counter_price=counter_price,
            requested_terms=requested_terms
        )

        state.negotiations = [resp.negotiation_state if n.negotiation_id == negotiation_id else n for n in state.negotiations]
        state.audit_log.insert(0, audit)

        if resp.negotiation_state.status == "ACCEPTED":
            try:
                self._transition(state, WorkflowState.QUOTE_READY)
            except InvalidStateTransitionError:
                pass

        self._emit_event_sync(OperationalEvent(
            event_type="counter_offer_submitted",
            project_id=project_id,
            vendor_id=neg.vendor_id,
            resource_id=neg.resource_id,
            agent_name="Negotiation Agent",
            payload={"current_price": resp.negotiation_state.current_price, "status": resp.negotiation_state.status}
        ))

        return state_manager.save_state(state)

    def accept_negotiation(self, project_id: str, negotiation_id: str) -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        neg = next((n for n in state.negotiations if n.negotiation_id == negotiation_id), None)
        if not neg:
            raise ValueError(f"Negotiation {negotiation_id} not found")

        updated_neg, audit = self.negotiation.accept_offer(neg)
        state.negotiations = [updated_neg if n.negotiation_id == negotiation_id else n for n in state.negotiations]
        state.audit_log.insert(0, audit)

        try:
            self._transition(state, WorkflowState.QUOTE_READY)
        except InvalidStateTransitionError:
            pass

        self._emit_event_sync(OperationalEvent(
            event_type="negotiation_completed",
            project_id=project_id,
            vendor_id=neg.vendor_id,
            resource_id=neg.resource_id,
            agent_name="Negotiation Agent",
            payload={"final_agreed_price": updated_neg.current_price}
        ))

        return state_manager.save_state(state)

    # Stage 4: Run Compliance Check
    def run_compliance(self, project_id: str, vendor_id: str = "V003") -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        try:
            self._transition(state, WorkflowState.COMPLIANCE_CHECKING)
        except InvalidStateTransitionError:
            pass

        total_package_value = 1449000.0
        if state.negotiations:
            total_package_value = state.negotiations[0].current_price + 1007400.0

        result, audit = self.compliance.check_compliance(
            vendor_id=vendor_id,
            deal_amount=total_package_value
        )

        state.compliance = result.documents
        state.risk_assessments = result.risk
        state.approvals = [result.approval]
        state.audit_log.insert(0, audit)

        if result.approval.status == "BLOCKED":
            self._transition(state, WorkflowState.BLOCKED)
        elif result.approval.requires_producer_approval:
            self._transition(state, WorkflowState.APPROVAL_REQUIRED)
        else:
            self._transition(state, WorkflowState.APPROVED)

        self._emit_event_sync(OperationalEvent(
            event_type="compliance_completed",
            project_id=project_id,
            vendor_id=vendor_id,
            agent_name="Compliance & Approval Agent",
            payload={"risk_level": result.risk.overall_level, "approval_required": result.approval.requires_producer_approval}
        ))

        return state_manager.save_state(state)

    # Stage 5: Producer Decision (Approve / Reject)
    def record_approval(self, project_id: str, approval_id: str, approved: bool, notes: str = "") -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        decision, audit = self.compliance.record_decision(
            approval_id=approval_id,
            approved=approved,
            notes=notes
        )

        state.approvals = [decision]
        state.audit_log.insert(0, audit)

        if approved:
            self._transition(state, WorkflowState.APPROVED)
            booking = BookingRecord(
                booking_id=f"BKG-{state.project.project_id}-001",
                resource_id="CAM-001",
                resource_name="ARRI Alexa Mini LF Package + 2x Primes",
                vendor_id="V001",
                vendor_name="LightForge Rentals",
                price=412000.0,
                status="CONFIRMED",
                delivery_date="2026-08-20",
                insurance_covered=True
            )
            state.bookings = [booking]
            self._transition(state, WorkflowState.BOOKED)

            self._emit_event_sync(OperationalEvent(
                event_type="booking_created",
                project_id=project_id,
                resource_id="CAM-001",
                vendor_id="V001",
                agent_name="Booking Engine",
                payload={"booking_id": booking.booking_id, "agreed_price": booking.price, "simulated": True}
            ))
            self._emit_event_sync(OperationalEvent(
                event_type="delivery_started",
                project_id=project_id,
                resource_id="CAM-001",
                vendor_id="V001",
                agent_name="Logistics Dispatch",
                payload={"delivery_date": booking.delivery_date}
            ))
        else:
            self._transition(state, WorkflowState.BLOCKED)

        return state_manager.save_state(state)

    # Stage 6: Trigger Incident
    def trigger_incident(self, project_id: str, incident: Incident) -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        backend_client.mark_unavailable(incident.resource_id)
        for b in state.bookings:
            if b.resource_id == incident.resource_id:
                b.status = "AT_RISK"

        state.incidents.insert(0, incident)

        audit = AuditLogEntry(
            agent="recovery",
            agent_name="Emergency Recovery Agent",
            action="INCIDENT_ALERT_TRIGGERED",
            status="failed",
            input_summary=f"Incident: {incident.event} on {incident.resource_id}",
            output_summary=f"Severity: {incident.severity} | Details: {incident.details.get('message', '')}",
            policy_checks=["On-site telemetry threshold triggered", "Active booking flagged as AT_RISK"],
            warnings=[f"Shooting blocked: {incident.resource_id} is non-operational"],
            next_action="Initiate Emergency Recovery Agent re-sourcing"
        )
        state.audit_log.insert(0, audit)

        try:
            self._transition(state, WorkflowState.INCIDENT_DETECTED)
        except InvalidStateTransitionError:
            pass

        self._emit_event_sync(OperationalEvent(
            event_type="resource_unavailable",
            project_id=project_id,
            resource_id=incident.resource_id,
            agent_name="Grafana MCP",
            severity="CRITICAL",
            payload=incident.details,
            external_incident_id=incident.incident_id
        ))

        return state_manager.save_state(state)

    # Stage 7: Run Emergency Recovery
    def run_recovery(self, project_id: str, incident_id: Optional[str] = None) -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        # Query Grafana incidents
        grafana_incidents: List[Incident] = []
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                grafana_incidents = asyncio.run_coroutine_threadsafe(grafana_client.get_incidents(project_id), loop).result(timeout=2.0)
            else:
                grafana_incidents = loop.run_until_complete(grafana_client.get_incidents(project_id))
        except Exception:
            try:
                grafana_incidents = asyncio.run(grafana_client.get_incidents(project_id))
            except Exception:
                grafana_incidents = []

        if grafana_incidents and not state.incidents:
            state.incidents = grafana_incidents

        inc = state.incidents[0] if state.incidents else (
            grafana_incidents[0] if grafana_incidents else Incident(
                incident_id=incident_id or "INC-GRAFANA-001",
                resource_id="CAM-001",
                details={"message": "Booked camera became unavailable mid-shoot in Agumbe rainforest."}
            )
        )

        try:
            self._transition(state, WorkflowState.RECOVERY_IN_PROGRESS)
        except InvalidStateTransitionError:
            pass

        plan, audit = self.recovery.calculate_recovery_options(
            incident=inc,
            original_price=480000.0,
            target_specs={"low_light": True, "weather_sealed": True, "scenes": 2}
        )

        state.recovery_options = plan.options
        state.audit_log.insert(0, audit)

        try:
            self._transition(state, WorkflowState.RECOVERY_APPROVAL_REQUIRED)
        except InvalidStateTransitionError:
            pass

        return state_manager.save_state(state)

    # Stage 8: Approve Recovery
    def approve_recovery(self, project_id: str, recovery_option_id: str = "CAM-002") -> ProductionState:
        state = state_manager.get_state(project_id)
        if not state:
            raise ValueError(f"Project {project_id} not found")

        for b in state.bookings:
            if b.status == "AT_RISK":
                b.status = "REPLACED"

        recovery_booking = BookingRecord(
            booking_id=f"BKG-RECOVERY-{state.project.project_id}",
            resource_id="CAM-002",
            resource_name="Sony FX9 Low-Light Dual-ISO Cinema Package",
            vendor_id="V003",
            vendor_name="ForestFrame Rentals",
            price=488000.0,
            status="CONFIRMED",
            delivery_date="2026-08-20 (Emergency 2hr Delivery)",
            insurance_covered=True
        )
        state.bookings.insert(0, recovery_booking)

        audit = AuditLogEntry(
            agent="recovery",
            agent_name="Emergency Recovery Agent",
            action="RECOVERY_COST_DELTA_APPROVED",
            status="successful",
            input_summary=f"Producer approved replacement: {recovery_option_id} (+₹8,000 delta)",
            output_summary="Confirmed Sony FX9 replacement package from ForestFrame Rentals. Schedule impact: 0 delay.",
            policy_checks=["Cost delta authorized by producer", "Replacement logistics dispatched", "Zero schedule delay confirmed"],
            next_action="Continue production shooting schedule"
        )
        state.audit_log.insert(0, audit)

        self._transition(state, WorkflowState.RECOVERY_APPROVED)

        self._emit_event_sync(OperationalEvent(
            event_type="booking_updated",
            project_id=project_id,
            resource_id="CAM-002",
            vendor_id="V003",
            agent_name="Emergency Recovery Agent",
            payload={"replaced_resource": "CAM-001", "new_booking_id": recovery_booking.booking_id, "cost_delta": 8000.0}
        ))

        return state_manager.save_state(state)

production_workflow = ProductionWorkflow()
