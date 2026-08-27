import pytest
from backend.app.agents.scout.agent import MarketplaceScoutAgent
from backend.app.agents.common.schemas import Requirement, CandidateVendor
from backend.app.agents.scout.ranking import ScoutRanker

def test_scout_hard_filtering_and_ranking():
    agent = MarketplaceScoutAgent()
    reqs = [
        Requirement(
            requirement_id="REQ-CAM-001",
            category="EQUIPMENT",
            resource="Low light cinema camera",
            resource_type="CAMERA",
            quantity=1,
            duration_days=3,
            specifications={"low_light": True, "scenes": 2},
            priority="CRITICAL",
            mandatory=True
        )
    ]

    result, audit = agent.run(requirements=reqs, remaining_budget=2500000.0)
    assert result.total_searched > 0
    assert len(result.recommendations) > 0
    assert audit.status == "successful"

    # Top recommendation should be compliant and high scoring
    top_cand = result.recommendations[0]
    assert top_cand.hard_constraints_passed is True
    assert top_cand.score >= 85.0
    assert "suitability" in top_cand.score_breakdown
    assert "availability" in top_cand.score_breakdown

    # Rejected candidates should include unavailable CAM-004 or uninsured/non-low-light CAM-003
    rejected_ids = [r.candidate.resource_id for r in result.rejected_candidates]
    assert "CAM-003" in rejected_ids or "CAM-004" in rejected_ids

def test_scout_budget_filtering():
    # If budget is only 10,000, expensive equipment must be rejected
    candidates = [
        CandidateVendor(
            vendor_id="V001",
            vendor_name="Test Vendor",
            resource_id="EXPENSIVE-01",
            resource_name="Costly Camera",
            resource_type="CAMERA",
            price=500000.0,
            currency="INR",
            available=True,
            delivery_days=1,
            distance_km=10,
            reliability_score=95.0,
            suitability_score=95.0,
            quality_score=95.0,
            insurance_included=True,
            insurance_required=True,
            specifications={"low_light": True}
        )
    ]
    recs, rejected = ScoutRanker.rank_candidates(candidates, remaining_budget=10000.0)
    assert len(recs) == 0
    assert len(rejected) == 1
    assert any("budget" in r.lower() for r in rejected[0].rejected_reasons)

def test_scout_tools():
    agent = MarketplaceScoutAgent()
    cameras = agent.search_resources(resource_type="CAMERA")
    assert len(cameras) >= 3

    avail = agent.check_availability("CAM-001", "2026-08-20", 3)
    assert isinstance(avail, bool)

    vendor = agent.get_vendor_details("V003")
    assert vendor is not None
    assert vendor.get("vendor_name") == "ForestFrame Rentals"
