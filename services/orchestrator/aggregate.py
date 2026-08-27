"""Assembly of the fat read model the frontend asks for.

Everything in here is a *pure* function over rows and audit payloads the caller
has already loaded. No I/O, no session - which is the point: the shape of the
contract is testable without a database, and the endpoint in main.py stays a
thin query layer.

The governing rule is that nothing is invented. Several things the UI wants were
never captured by any agent; they are named in NEVER_CAPTURED together with the
reason, and reported under the response's `unavailable` key rather than filled
in with a plausible-looking number.
"""
import uuid
from dataclasses import dataclass
from typing import Any

from cinex.db.models import (
    Approval, AuditLog, Booking, ComplianceCheck, Offer, Production, RecoveryEvent, Requirement,
    Vendor,
)
from cinex.steps import StepEvent

BRIEF_PREVIEW_CHARS = 200
TRUNCATION_SUFFIX = "..."

# Audit actions this read model understands. Each is a real write_audit call
# site; grep the string to find the agent that emits it.
ACTION_FIND_VENDORS = "find_vendors"              # scout-agent, entity=requirement
ACTION_NEGOTIATION_ROUND = "negotiation_round"    # negotiation-agent, entity=offer
ACTION_NEGOTIATE = "negotiate"                    # negotiation-agent, entity=requirement
ACTION_NEGOTIATE_FAILED = "negotiate_failed"      # negotiation-agent, entity=requirement
ACTION_CHECK_COMPLIANCE = "check_compliance"      # compliance-agent, entity=production
ACTION_PIPELINE_FAILED = "pipeline_failed"        # orchestrator, entity=production
NEGOTIATION_TERMINAL_ACTIONS = ("negotiation_walk_away", "negotiation_vendor_unavailable")
APPROVAL_DECISION_PREFIX = "approval_"            # producer, entity=approval
APPROVAL_GATE_STEP_NAME = "approval_gate"

# Fields the frontend brief asked for that no agent has ever written anywhere -
# not as a column, not inside an audit payload, not in a recovery timeline. They
# are surfaced to the client as an explicit "unavailable" map so the UI can show
# an honest empty state instead of a fabricated one.
NEVER_CAPTURED: dict[str, str] = {
    "vendor_score_breakdown": (
        "services/scout_agent/ranking.py score() is evaluated only as a sorted() key and "
        "then discarded. Neither the composite score nor its inputs (price ratio, rating "
        "ratio, the 0.6/0.4 weights, the cheapest-quote denominator, whether "
        "UNAVAILABLE_PENALTY was applied) are persisted. Only the resulting ordinal rank "
        "survives, inside the scout find_vendors audit payload."
    ),
    "risk_assessment": (
        "No risk model exists in this system. There is no risk score, level, factor, "
        "likelihood or impact in any table, audit payload or timeline - the substring "
        "'risk' does not occur anywhere in cinex/ or services/. The adjacent facts that "
        "DO exist are compliance.checks[].status, approvals[].threshold_breached, "
        "approvals[].delta_amount and delta_pct, offers[].available, and the recovery "
        "timeline's schedule collisions."
    ),
    "compliance_documents": (
        "There is no document store. compliance.checks[].evidence is a small dict of mock "
        "registry facts (authority, blackout window, rider threshold, missing credentials) "
        "carrying the literal disclaimer 'MOCK DATA - not a real regulatory check'. No "
        "document id, filename, issuer, issue or expiry date, upload or download URL is "
        "produced anywhere."
    ),
    "recovery_options": (
        "Recovery never presents options to choose between. It scouts replacements, "
        "negotiates, and commits ONE swap before the producer is asked anything; the only "
        "decision offered is approve/reject on a swap that has already happened. The sole "
        "trace of the alternatives considered is recovery timeline step 1's "
        "candidate_names - names only, with no per-candidate price, offer id or score."
    ),
    "producer_profile": (
        "productions.producer_id is a bare UUID. There is no producers or users table, so "
        "no name, email, company or avatar exists for the authenticated producer."
    ),
    "currency": (
        "Money columns are Numeric(12,2) with no currency column, and cinex.config.Settings "
        "has no currency setting. Rendering any currency symbol would be an invention."
    ),
    "vendor_contact_details": (
        "vendors.contact_meta holds only the mock service endpoint used to place quote and "
        "negotiate calls. No phone, email, address or account manager is stored."
    ),
    "savings_vs_list_price": (
        "No per-offer opening/list price is retained. offers.price is overwritten in place "
        "when a vendor accepts, and vendors.base_price is the current mutable value rather "
        "than the one quoted against. budget_cap minus total_cost is computable; 'saved X% "
        "off list' is not."
    ),
    "vendor_rating_at_quote_time": (
        "Offers do not snapshot the vendor rating they were ranked on. vendor_rating_current "
        "below is the CURRENT mutable value, not a historical record of what scout scored."
    ),
    "llm_usage": (
        "No model name, prompt or response token count, latency or per-call cost is "
        "recorded for any Gemini call. Only the model's parsed decision and its rationale "
        "reach the audit log."
    ),
    "step_durations": (
        "Steps record only the instant they were written (audit_log.created_at). No "
        "duration or ETA is stored; elapsed time is derivable client-side by differencing "
        "consecutive step timestamps."
    ),
}


@dataclass(frozen=True)
class ProductionRecords:
    """Everything the detail endpoint loaded, handed to the pure assembler."""

    production: Production
    requirements: list[Requirement]
    offers: list[Offer]
    vendors: dict[uuid.UUID, Vendor]
    bookings: list[Booking]
    checks: list[ComplianceCheck]
    approvals: list[Approval]
    recovery_events: list[RecoveryEvent]
    steps: list[StepEvent]
    audit: list[AuditLog]


def _text(value: Any) -> str | None:
    """Decimals, UUIDs and dates cross the wire as exact strings; None stays None.

    Money is never emitted as a JSON number - a float round-trip loses cents.
    """
    return None if value is None else str(value)


def _ts(value: Any) -> str | None:
    return None if value is None else value.isoformat()


def truncate_brief(text: str, limit: int = BRIEF_PREVIEW_CHARS) -> tuple[str, bool]:
    """Preview of a brief for the list endpoint. Returns (preview, was_truncated)."""
    if len(text) <= limit:
        return text, False
    return text[:limit].rstrip() + TRUNCATION_SUFFIX, True


def build_summary(production: Production, limit: int = BRIEF_PREVIEW_CHARS) -> dict:
    """One row of GET /productions."""
    preview, truncated = truncate_brief(production.brief_text or "", limit)
    return {
        "production_id": str(production.id),
        "status": production.status,
        "brief_text": preview,
        "brief_truncated": truncated,
        "budget_cap": _text(production.budget_cap),
        "total_cost": _text(production.total_cost),
        "created_at": _ts(production.created_at),
    }


def _index_scout(audit: list[AuditLog]) -> tuple[dict[str, dict], dict[str, list[dict]]]:
    """Scout's find_vendors payload, split into per-offer facts and per-requirement runs.

    rank and available live ONLY here - neither is a column on offers - so an offer
    with no corresponding scout audit row simply reports them as null.
    """
    by_offer: dict[str, dict] = {}
    runs: dict[str, list[dict]] = {}
    for row in audit:
        if row.action != ACTION_FIND_VENDORS or row.entity_type != "requirement":
            continue
        payload = row.payload or {}
        rid = str(row.entity_id)
        runs.setdefault(rid, []).append({
            "ts": _ts(row.created_at),
            "category": payload.get("category"),
            "considered": payload.get("considered"),
            "excluded_vendor_ids": payload.get("excluded", []),
            "offers_returned": len(payload.get("offers") or []),
        })
        for entry in payload.get("offers") or []:
            offer_id = entry.get("offer_id")
            if offer_id:
                by_offer[offer_id] = entry
    return by_offer, runs


def _index_negotiation(
    audit: list[AuditLog], offer_to_requirement: dict[str, str]
) -> dict[str, dict]:
    """Round-by-round history, regrouped under the requirement it belongs to.

    Rounds are audited against the OFFER (entity_type='offer'); the run summary is
    audited against the REQUIREMENT. Both are stitched together here so the frontend
    gets exactly one negotiation object per requirement.
    """
    out: dict[str, dict] = {}

    def bucket(requirement_id: str) -> dict:
        return out.setdefault(requirement_id, {
            "runs": [], "rounds": [], "terminal_events": [], "failures": [],
        })

    for row in audit:
        payload = row.payload or {}
        entity_id = str(row.entity_id) if row.entity_id else None

        if row.entity_type == "offer" and row.action == ACTION_NEGOTIATION_ROUND:
            rid = offer_to_requirement.get(entity_id)
            if rid is None:
                continue
            bucket(rid)["rounds"].append({
                "ts": _ts(row.created_at),
                "offer_id": entity_id,
                "vendor_id": payload.get("vendor_id"),
                "vendor_name": payload.get("vendor_name"),
                "round": payload.get("round"),
                "offered": payload.get("offered"),
                "conceded_terms": payload.get("conceded_terms", []),
                "rationale": payload.get("rationale"),
                "decision": payload.get("decision"),
                "vendor_price": payload.get("vendor_price"),
                "vendor_message": payload.get("vendor_message"),
            })
        elif row.entity_type == "offer" and row.action in NEGOTIATION_TERMINAL_ACTIONS:
            rid = offer_to_requirement.get(entity_id)
            if rid is None:
                continue
            bucket(rid)["terminal_events"].append({
                "ts": _ts(row.created_at),
                "offer_id": entity_id,
                "event": row.action,
                "round": payload.get("round"),
                "rationale": payload.get("rationale"),
                "error": payload.get("error"),
            })
        elif row.entity_type == "requirement" and row.action == ACTION_NEGOTIATE:
            bucket(entity_id)["runs"].append({
                "ts": _ts(row.created_at),
                "max_rounds": payload.get("max_rounds"),
                "market_anchor": payload.get("anchor"),
                "winning_offer_id": payload.get("winner"),
                "final_price": payload.get("final_price"),
                "settled": payload.get("settled"),
                "settled_count": payload.get("settled_count"),
                "outcomes": payload.get("outcomes", []),
            })
        elif row.entity_type == "requirement" and row.action == ACTION_NEGOTIATE_FAILED:
            bucket(entity_id)["failures"].append({
                "ts": _ts(row.created_at),
                "error": payload.get("error"),
                "completed_offers": payload.get("completed_offers"),
                "completed_rounds": payload.get("completed_rounds"),
            })
    return out


def _index_approval_context(
    audit: list[AuditLog], steps: list[StepEvent], recovery_events: list[RecoveryEvent]
) -> dict[str, dict]:
    """delta_pct and kind for an approval - neither of which is a column.

    delta_pct is only ever written into the step-9 approval_gate detail (happy path)
    or the recovery timeline's step-7 gate entry (recovery). kind comes from the
    producer's approval_{approved,rejected} audit row.
    """
    context: dict[str, dict] = {}

    def slot(approval_id: str) -> dict:
        return context.setdefault(approval_id, {})

    for step in steps:
        if step.name != APPROVAL_GATE_STEP_NAME:
            continue
        detail = step.detail or {}
        approval_id = detail.get("approval_id")
        if approval_id:
            slot(approval_id).update({
                "delta_pct": detail.get("delta_pct"),
                "reasons": detail.get("reasons"),
                "source": "step.approval_gate",
            })

    for event in recovery_events:
        for entry in event.timeline or []:
            detail = entry.get("detail") or {}
            approval_id = detail.get("approval_id")
            if approval_id:
                slot(approval_id).update({
                    "delta_pct": detail.get("delta_pct"),
                    "reasons": detail.get("reasons"),
                    "threshold_pct": detail.get("threshold_pct"),
                    "source": "recovery_timeline.approval_gate",
                    "recovery_event_id": str(event.id),
                })

    for row in audit:
        if row.entity_type != "approval" or not row.action.startswith(APPROVAL_DECISION_PREFIX):
            continue
        payload = row.payload or {}
        slot(str(row.entity_id)).update({
            "kind": payload.get("kind"),
            "decided_recovery_event_id": payload.get("recovery_event_id"),
        })
    return context


def _vendor_view(vendor: Vendor | None) -> dict:
    if vendor is None:
        return {"vendor_name": None, "vendor_category": None, "vendor_rating_current": None}
    return {
        "vendor_name": vendor.name,
        "vendor_category": vendor.category,
        # Deliberately named _current: this is today's mutable rating, NOT the value
        # scout ranked the offer on. See NEVER_CAPTURED["vendor_rating_at_quote_time"].
        "vendor_rating_current": _text(vendor.rating),
    }


def build_detail(records: ProductionRecords) -> dict:
    """The aggregate GET /productions/{production_id} body."""
    production = records.production
    audit = records.audit

    offer_to_requirement = {str(o.id): str(o.requirement_id) for o in records.offers}
    offers_by_requirement: dict[str, list[Offer]] = {}
    for offer in records.offers:
        offers_by_requirement.setdefault(str(offer.requirement_id), []).append(offer)

    scout_by_offer, scout_runs = _index_scout(audit)
    negotiation = _index_negotiation(audit, offer_to_requirement)
    approval_context = _index_approval_context(audit, records.steps, records.recovery_events)

    compliance_overall = None
    equipment_value = None
    failure = None
    for row in audit:
        if row.entity_type != "production":
            continue
        payload = row.payload or {}
        if row.action == ACTION_CHECK_COMPLIANCE:
            compliance_overall = payload.get("overall", compliance_overall)
            equipment_value = payload.get("equipment_value", equipment_value)
        elif row.action == ACTION_PIPELINE_FAILED:
            failure = {"ts": _ts(row.created_at), "step": payload.get("step"),
                       "reason": payload.get("reason")}

    requirements = []
    for requirement in records.requirements:
        rid = str(requirement.id)
        offer_views = []
        for offer in offers_by_requirement.get(rid, []):
            scouted = scout_by_offer.get(str(offer.id), {})
            offer_views.append({
                "offer_id": str(offer.id),
                "vendor_id": str(offer.vendor_id),
                **_vendor_view(records.vendors.get(offer.vendor_id)),
                "price": _text(offer.price),
                "terms": offer.terms or {},
                "status": offer.status,
                "rounds_completed": offer.round,
                "is_winner": offer.is_winner,
                "created_at": _ts(offer.created_at),
                # From scout's audit payload only - null when no such row exists.
                "rank": scouted.get("rank"),
                "available": scouted.get("available"),
                "quoted_price": scouted.get("price"),
                # Never captured. Kept as an explicit null rather than omitted, so a
                # TypeScript client sees the field and finds the reason in `unavailable`.
                "score_breakdown": None,
            })
        # Scout's rank where it exists; unranked offers last, in insertion order.
        offer_views.sort(key=lambda o: (o["rank"] is None, o["rank"] or 0))

        requirements.append({
            "requirement_id": rid,
            "category": requirement.category,
            "spec": requirement.spec or {},
            "quantity": requirement.quantity,
            "priority": requirement.priority,
            "created_at": _ts(requirement.created_at),
            "discovery_runs": scout_runs.get(rid, []),
            "offers": offer_views,
            "negotiation": negotiation.get(
                rid, {"runs": [], "rounds": [], "terminal_events": [], "failures": []}
            ),
        })

    offer_by_id = {o.id: o for o in records.offers}
    bookings = []
    for booking in records.bookings:
        offer = offer_by_id.get(booking.offer_id)
        vendor = records.vendors.get(offer.vendor_id) if offer else None
        bookings.append({
            "booking_id": str(booking.id),
            "offer_id": str(booking.offer_id),
            "requirement_id": str(offer.requirement_id) if offer else None,
            "vendor_id": str(offer.vendor_id) if offer else None,
            **_vendor_view(vendor),
            "final_price": _text(booking.final_price),
            "status": booking.status,
            "booked_at": _ts(booking.booked_at),
            "created_at": _ts(booking.created_at),
        })

    approvals = []
    for approval in records.approvals:
        extra = approval_context.get(str(approval.id), {})
        approvals.append({
            "approval_id": str(approval.id),
            "requested_by_agent": approval.requested_by_agent,
            "reason": approval.reason,
            "threshold_breached": approval.threshold_breached,
            "delta_amount": _text(approval.delta_amount),
            "producer_decision": approval.producer_decision,
            "decided_at": _ts(approval.decided_at),
            "created_at": _ts(approval.created_at),
            # From audit/step payloads, not columns:
            "delta_pct": extra.get("delta_pct"),
            "reasons": extra.get("reasons"),
            "threshold_pct": extra.get("threshold_pct"),
            "kind": extra.get("kind"),
        })

    return {
        "production": {
            "production_id": str(production.id),
            "producer_id": str(production.producer_id),
            "brief_text": production.brief_text,
            "budget_cap": _text(production.budget_cap),
            "total_cost": _text(production.total_cost),
            "location": production.location,
            "start_date": _ts(production.start_date),
            "end_date": _ts(production.end_date),
            "status": production.status,
            "current_step": production.current_step,
            "created_at": _ts(production.created_at),
            "updated_at": _ts(production.updated_at),
        },
        "steps": [
            {"step": s.step, "name": s.name, "status": s.status,
             "detail": s.detail, "ts": _ts(s.ts), "seq": s.seq}
            for s in records.steps
        ],
        "requirements": requirements,
        "compliance": {
            "overall": compliance_overall,
            "equipment_value": equipment_value,
            "checks": [
                {"check_id": str(c.id), "check_type": c.check_type, "status": c.status,
                 "evidence": c.evidence or {},
                 "booking_id": str(c.booking_id) if c.booking_id else None,
                 "created_at": _ts(c.created_at)}
                for c in records.checks
            ],
        },
        "approvals": approvals,
        "bookings": bookings,
        "recovery_events": [
            {"recovery_event_id": str(e.id), "trigger": e.trigger, "status": e.status,
             "affected_booking_id": (
                 str(e.affected_booking_id) if e.affected_booking_id else None),
             "resolution_booking_id": (
                 str(e.resolution_booking_id) if e.resolution_booking_id else None),
             "timeline": e.timeline or [], "created_at": _ts(e.created_at)}
            for e in records.recovery_events
        ],
        "failure": failure,
        "unavailable": NEVER_CAPTURED,
    }
