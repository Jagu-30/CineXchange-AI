"""Rules-based compliance against MOCK registries.

Nothing here contacts a real permitting authority, insurer, or licensing body.
Every evidence payload says so - the demo must never imply otherwise.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

DISCLAIMER = "MOCK DATA - not a real regulatory check"

PERMIT_REGISTRY: dict[str, dict] = {
    "lisbon": {"authority": "Camara Municipal de Lisboa",
               "blackout": [(date(2026, 12, 24), date(2026, 12, 26))]},
    "porto": {"authority": "Camara Municipal do Porto", "blackout": []},
    "sintra": {"authority": "Camara Municipal de Sintra",
               "blackout": [(date(2026, 8, 1), date(2026, 8, 15))]},
}

CREDENTIAL_REGISTRY: dict[str, bool] = {
    "drone operator": False,      # deliberately missing - drives the demo's compliance failure
    "pyrotechnics": True,
    "stunts": True,
    "underwater": True,
}

PERMIT_TRIGGERING_CATEGORIES = {"location", "permit"}


@dataclass(frozen=True)
class CheckResult:
    check_type: str
    status: str                    # pass | fail | pending
    evidence: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ApprovalDecision:
    required: bool
    reasons: list[str]
    delta_amount: Decimal
    delta_pct: float
    threshold_breached: bool


def check_permit(location: str, start_date: date, end_date: date, categories: set[str]) -> CheckResult:
    if not (categories & PERMIT_TRIGGERING_CATEGORIES):
        return CheckResult("permit", "pass", {
            "required": False, "source": "mock_municipal_registry", "disclaimer": DISCLAIMER,
        })

    entry = PERMIT_REGISTRY.get(location.strip().lower())
    if entry is None:
        return CheckResult("permit", "fail", {
            "required": True, "reason": f"no registry entry for {location}",
            "source": "mock_municipal_registry", "disclaimer": DISCLAIMER,
        })

    for blackout_start, blackout_end in entry["blackout"]:
        if start_date <= blackout_end and end_date >= blackout_start:
            return CheckResult("permit", "fail", {
                "required": True,
                "reason": f"blackout window {blackout_start}..{blackout_end}",
                "authority": entry["authority"],
                "source": "mock_municipal_registry", "disclaimer": DISCLAIMER,
            })

    return CheckResult("permit", "pass", {
        "required": True, "authority": entry["authority"],
        "window": [start_date.isoformat(), end_date.isoformat()],
        "source": "mock_municipal_registry", "disclaimer": DISCLAIMER,
    })


def check_insurance(equipment_value: Decimal, threshold: Decimal) -> CheckResult:
    needed = equipment_value > threshold
    return CheckResult(
        "insurance",
        "fail" if needed else "pass",
        {
            "equipment_value": str(equipment_value),
            "threshold": str(threshold),
            "rider_required": needed,
            "reason": "equipment value exceeds the rider threshold" if needed else "within threshold",
            "source": "mock_insurance_rules", "disclaimer": DISCLAIMER,
        },
    )


def check_licensing(crew_specs: list[dict]) -> CheckResult:
    missing = [
        spec.get("role", "unknown")
        for spec in crew_specs
        if spec.get("requires_certification")
        and not CREDENTIAL_REGISTRY.get(str(spec.get("role", "")).strip().lower(), False)
    ]
    return CheckResult(
        "licensing",
        "fail" if missing else "pass",
        {
            "missing": missing,
            "checked": [s.get("role") for s in crew_specs],
            "source": "mock_credential_registry", "disclaimer": DISCLAIMER,
        },
    )


def evaluate_approval(
    total_cost: Decimal,
    budget_cap: Decimal,
    baseline: Decimal,
    check_statuses: list[str],
    threshold_pct: float,
) -> ApprovalDecision:
    """The one place the human-in-the-loop gate is decided.

    baseline is budget_cap on the happy path and the pre-recovery total_cost
    during recovery. See spec section 5.4.
    """
    delta_amount = total_cost - baseline
    delta_pct = float(delta_amount / baseline * 100) if baseline > 0 else 0.0
    threshold_breached = delta_pct > threshold_pct

    reasons: list[str] = []
    if total_cost > budget_cap:
        reasons.append("over_budget_cap")
    if threshold_breached:
        reasons.append("threshold_breached")
    if any(status == "fail" for status in check_statuses):
        reasons.append("compliance_failed")

    return ApprovalDecision(
        required=bool(reasons),
        reasons=reasons,
        delta_amount=delta_amount,
        delta_pct=delta_pct,
        threshold_breached=threshold_breached,
    )
