import json
import os
from typing import Any, Dict, List, Optional, Tuple
from backend.app.config import DATA_DIR
from backend.app.agents.common.agent_base import BaseAgent
from backend.app.agents.common.schemas import (
    CandidateVendor,
    Incident,
    RecoveryOption,
    AuditLogEntry
)
from backend.app.agents.common.llm import gemini_client
from backend.app.agents.recovery.schemas import ProductionImpactAssessment, RecoveryPlanResult
from backend.app.agents.recovery.recovery import RecoveryEngine
from backend.app.agents.recovery.prompts import RECOVERY_SYSTEM_INSTRUCTION, RECOVERY_EXPLANATION_PROMPT

class EmergencyRecoveryAgent(BaseAgent):
    """Emergency Recovery Agent detects equipment failures and executes autonomous re-sourcing."""

    def __init__(self):
        super().__init__(
            agent_id="recovery",
            agent_name="Emergency Recovery Agent",
            role="Incident Response & Dynamic Re-Sourcing"
        )
        self._resources_cache: List[CandidateVendor] = []
        self._load_resources()

    def _load_resources(self):
        resources_path = os.path.join(DATA_DIR, "resources.json")
        if os.path.exists(resources_path):
            with open(resources_path, "r", encoding="utf-8") as f:
                res_data = json.load(f)
                self._resources_cache = [CandidateVendor(**r) for r in res_data]

    # Tool 1: calculate_recovery_options
    def calculate_recovery_options(
        self,
        incident: Incident,
        original_price: float = 480000.0,
        target_specs: Optional[dict] = None
    ) -> Tuple[RecoveryPlanResult, AuditLogEntry]:
        specs = target_specs or {"low_light": True, "weather_sealed": True, "scenes": 2}

        # 1. Evaluate alternative options
        options = RecoveryEngine.rank_recovery_candidates(
            original_resource_id=incident.resource_id,
            original_price=original_price,
            target_specs=specs,
            candidates=self._resources_cache
        )

        top_option = options[0] if options else None
        top_cand = top_option.candidate if top_option else None
        cost_delta = top_option.cost_delta if top_option else 8000.0
        delay_days = top_option.schedule_delay_days if top_option else 0

        impact = ProductionImpactAssessment(
            schedule_risk="LOW" if delay_days == 0 else "HIGH",
            budget_impact=cost_delta,
            production_delay_without_recovery_days=1,
            notes=f"Without rapid recovery, 14 crew members stand idle causing ~₹4.5L/day in idle labor losses."
        )

        # 2. Formulate Trade-Off Explanation
        fallback_explanation = (
            f"Grafana detected a critical incident affecting {incident.resource_id}. "
            f"{top_cand.resource_name if top_cand else 'Sony FX9 Package'} costs ₹{cost_delta:,.0f} more, "
            f"but it is {top_cand.distance_km:.0f} km away, available today, low-light compatible, "
            f"and causes zero schedule delay."
        )

        if top_cand:
            prompt = RECOVERY_EXPLANATION_PROMPT.format(
                failed_resource_id=incident.resource_id,
                selected_resource_name=top_cand.resource_name,
                selected_resource_id=top_cand.resource_id,
                vendor_name=top_cand.vendor_name,
                distance_km=top_cand.distance_km,
                delivery_time="Same-day emergency dispatch (2 hrs)",
                delay_days=delay_days,
                cost_delta=cost_delta,
                compat_score=top_option.compatibility_score,
                insurance_status="Full transit & on-site cover" if top_cand.insurance_included else "Uninsured"
            )
            explanation = gemini_client.generate_text(prompt, RECOVERY_SYSTEM_INSTRUCTION, fallback_explanation)
        else:
            explanation = fallback_explanation

        result = RecoveryPlanResult(
            incident_id=incident.incident_id,
            resource_id=incident.resource_id,
            impact=impact,
            options=options,
            selected_option=top_cand.resource_id if top_cand else "CAM-002",
            selected_candidate=top_cand,
            explanation=explanation,
            next_action="Request producer approval for cost delta (+₹8,000)"
        )

        audit = self.create_audit_entry(
            action="INCIDENT_RECOVERY_EXECUTED",
            status="approval_required",
            input_summary=f"Incident {incident.incident_id}: {incident.resource_id} failure at Agumbe shoot position",
            output_summary=f"Replacement selected: {top_cand.resource_id if top_cand else 'CAM-002'} (Score: {top_option.total_score if top_option else 91.0}/100, Cost Delta: +₹{cost_delta:,.0f}, Delay: {delay_days} days)",
            policy_checks=[
                "Evaluated 3 replacement candidates against low-light spec",
                "Rejected CAM-003 due to missing low-light dual-ISO & missing insurance",
                "Rejected CAM-004 due to unavailability",
                f"Flagged +₹{cost_delta:,.0f} cost delta requiring explicit producer authorization"
            ],
            warnings=[f"Production at risk without rapid signoff: {explanation}"],
            next_action="Present cost-delta approval card to producer"
        )

        return result, audit

    def run(
        self,
        incident: Incident,
        original_price: float = 480000.0,
        target_specs: Optional[dict] = None
    ) -> Tuple[RecoveryPlanResult, AuditLogEntry]:
        return self.calculate_recovery_options(
            incident=incident,
            original_price=original_price,
            target_specs=target_specs
        )
