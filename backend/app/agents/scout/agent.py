import json
import os
from typing import Any, Dict, List, Optional, Tuple
from backend.app.config import DATA_DIR
from backend.app.agents.common.agent_base import BaseAgent
from backend.app.agents.common.schemas import (
    CandidateVendor,
    Requirement,
    ScoredCandidate,
    AuditLogEntry
)
from backend.app.agents.scout.schemas import ScoutSearchResult
from backend.app.agents.scout.ranking import ScoutRanker

class MarketplaceScoutAgent(BaseAgent):
    """Marketplace Scout Agent searches, verifies, filters, and ranks vendors."""

    def __init__(self):
        super().__init__(
            agent_id="scout",
            agent_name="Marketplace Scout Agent",
            role="Vendor Discovery & Ranking"
        )
        self._vendors_cache: List[Dict[str, Any]] = []
        self._resources_cache: List[CandidateVendor] = []
        self._load_catalog()

    def _load_catalog(self):
        resources_path = os.path.join(DATA_DIR, "resources.json")
        vendors_path = os.path.join(DATA_DIR, "vendors.json")

        if os.path.exists(vendors_path):
            with open(vendors_path, "r", encoding="utf-8") as f:
                self._vendors_cache = json.load(f)

        if os.path.exists(resources_path):
            with open(resources_path, "r", encoding="utf-8") as f:
                res_data = json.load(f)
                self._resources_cache = [CandidateVendor(**r) for r in res_data]

    # Tool 1: search_resources
    def search_resources(self, category: Optional[str] = None, resource_type: Optional[str] = None) -> List[CandidateVendor]:
        results = self._resources_cache
        if category:
            results = [r for r in results if r.category.upper() == category.upper()]
        if resource_type:
            results = [r for r in results if r.resource_type.upper() == resource_type.upper()]
        return results

    # Tool 2: check_availability
    def check_availability(self, resource_id: str, start_date: str, duration_days: int) -> bool:
        for r in self._resources_cache:
            if r.resource_id == resource_id:
                return r.available
        return False

    # Tool 3: get_vendor_details
    def get_vendor_details(self, vendor_id: str) -> Optional[Dict[str, Any]]:
        for v in self._vendors_cache:
            if v.get("vendor_id") == vendor_id:
                return v
        return None

    def run(
        self,
        requirements: List[Requirement],
        remaining_budget: float = 2500000.0
    ) -> Tuple[ScoutSearchResult, AuditLogEntry]:
        candidates = self._resources_cache

        # Check if low light is required across camera requirements
        has_low_light = any(
            r.specifications.get("low_light", False)
            for r in requirements
            if r.resource_type == "CAMERA"
        )

        recommendations, rejected = ScoutRanker.rank_candidates(
            candidates=candidates,
            remaining_budget=remaining_budget,
            require_low_light=has_low_light
        )

        top_rec = recommendations[0] if recommendations else None
        top_name = f"{top_rec.candidate.vendor_name} ({top_rec.candidate.resource_name})" if top_rec else "None"
        top_score = f"{top_rec.score:.1f}" if top_rec else "0.0"

        result = ScoutSearchResult(
            recommendations=recommendations,
            rejected_candidates=rejected,
            total_searched=len(candidates),
            total_eligible=len(recommendations)
        )

        audit = self.create_audit_entry(
            action="SCOUT_MARKETPLACE",
            status="successful",
            input_summary=f"Searched {len(candidates)} vendor resources against {len(requirements)} requirements (Budget ₹{remaining_budget:,.0f})",
            output_summary=f"Found {len(recommendations)} compliant options. Top ranked: {top_name} (Score: {top_score}/100)",
            policy_checks=[
                f"Hard filter: Checked availability across all {len(candidates)} candidates",
                f"Hard filter: Rejected {len(rejected)} non-compliant candidates (low-light gaps, missing insurance, quality < 85)",
                "Applied 6-factor weighted scoring (Suitability 30%, Availability 20%, Reliability 20%, Price 15%, Delivery 10%, Insurance 5%)"
            ],
            warnings=[f"Rejected: {r.candidate.resource_name} - {', '.join(r.rejected_reasons)}" for r in rejected[:3]],
            next_action="Initialize negotiation with shortlisted vendors"
        )

        return result, audit
