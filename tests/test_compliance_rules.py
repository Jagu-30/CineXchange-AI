from datetime import date
from decimal import Decimal

import pytest

from services.compliance_agent.rules import (
    check_insurance, check_licensing, check_permit, evaluate_approval,
)


def test_permit_required_and_granted_for_a_known_location():
    result = check_permit("Lisbon", date(2026, 9, 1), date(2026, 9, 3), {"location", "camera"})
    assert result.check_type == "permit"
    assert result.status == "pass"
    assert result.evidence["source"] == "mock_municipal_registry"
    assert "MOCK DATA" in result.evidence["disclaimer"]


def test_permit_fails_for_a_blackout_window():
    result = check_permit("Lisbon", date(2026, 12, 24), date(2026, 12, 26), {"location"})
    assert result.status == "fail"
    assert "blackout" in result.evidence["reason"]


def test_permit_not_required_without_a_location_shoot():
    result = check_permit("Lisbon", date(2026, 9, 1), date(2026, 9, 3), {"insurance"})
    assert result.status == "pass"
    assert result.evidence["required"] is False


def test_insurance_rider_required_above_threshold():
    assert check_insurance(Decimal("60000"), Decimal("50000")).status == "fail"
    assert check_insurance(Decimal("40000"), Decimal("50000")).status == "pass"


def test_licensing_fails_when_a_certified_role_lacks_a_credential():
    result = check_licensing([{"role": "drone operator", "requires_certification": True}])
    assert result.status == "fail"
    assert "drone operator" in str(result.evidence["missing"])


def test_licensing_passes_for_a_credentialled_role():
    result = check_licensing([{"role": "gaffer", "requires_certification": False}])
    assert result.status == "pass"


def test_approval_not_required_when_within_budget_and_threshold():
    decision = evaluate_approval(
        total_cost=Decimal("100000"), budget_cap=Decimal("120000"),
        baseline=Decimal("100000"), check_statuses=["pass", "pass"], threshold_pct=10.0,
    )
    assert decision.required is False
    assert decision.reasons == []


def test_approval_required_when_over_the_budget_cap():
    decision = evaluate_approval(
        total_cost=Decimal("130000"), budget_cap=Decimal("120000"),
        baseline=Decimal("130000"), check_statuses=["pass"], threshold_pct=10.0,
    )
    assert decision.required is True
    assert "over_budget_cap" in decision.reasons


def test_approval_required_when_delta_exceeds_threshold():
    decision = evaluate_approval(
        total_cost=Decimal("112000"), budget_cap=Decimal("500000"),
        baseline=Decimal("100000"), check_statuses=["pass"], threshold_pct=10.0,
    )
    assert decision.required is True
    assert decision.threshold_breached is True
    assert decision.delta_pct == pytest.approx(12.0)
    assert decision.delta_amount == Decimal("12000")


def test_delta_exactly_at_threshold_does_not_trigger():
    decision = evaluate_approval(
        total_cost=Decimal("110000"), budget_cap=Decimal("500000"),
        baseline=Decimal("100000"), check_statuses=["pass"], threshold_pct=10.0,
    )
    assert decision.threshold_breached is False, "the gate is strictly greater-than"


def test_approval_required_when_any_check_fails():
    decision = evaluate_approval(
        total_cost=Decimal("10"), budget_cap=Decimal("120000"),
        baseline=Decimal("10"), check_statuses=["pass", "fail"], threshold_pct=10.0,
    )
    assert decision.required is True
    assert "compliance_failed" in decision.reasons


def test_zero_baseline_does_not_divide_by_zero():
    decision = evaluate_approval(
        total_cost=Decimal("500"), budget_cap=Decimal("1000"),
        baseline=Decimal("0"), check_statuses=["pass"], threshold_pct=10.0,
    )
    assert decision.delta_pct == 0.0
    assert decision.required is False
