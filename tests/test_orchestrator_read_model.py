"""The aggregate read model and CORS, tested without Postgres.

Two halves:

* `build_detail` / `build_summary` are pure functions over already-loaded rows,
  so the exact JSON contract the frontend writes TypeScript against is asserted
  here against in-memory model instances - no database, no Docker.
* CORS and the auth guards on the two new endpoints are exercised through
  `httpx.ASGITransport`. Both are resolved by middleware / dependencies before
  any handler opens a session, so they need no database either.

The one thing that genuinely cannot be covered here is the SQL in
`production_detail` itself. That is `tests/test_orchestrator_api.py`'s job and is
marked `integration`.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest

from cinex.auth import issue_demo_token
from cinex.config import get_settings
from cinex.db.models import (
    Approval, AuditLog, Booking, ComplianceCheck, Offer, Production, RecoveryEvent, Requirement,
    Vendor,
)
from cinex.steps import StepEvent
# Importing this builds the FastAPI app, which reads Settings once at import time
# to configure CORS. It reads .env for everything except DATABASE_URL, which
# conftest forces at the test database - the same assumption tests/test_auth.py
# already makes. Nothing here sets an environment variable: doing so would leak
# into tests/test_config.py, which asserts that a missing key is an error.
from services.orchestrator import main
from services.orchestrator.aggregate import (
    BRIEF_PREVIEW_CHARS, NEVER_CAPTURED, ProductionRecords, build_detail, build_summary,
    truncate_brief,
)

NOW = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(main, "run_happy_path", AsyncMock())
    monkeypatch.setattr(main, "resume_after_approval", AsyncMock())
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as c:
        yield c


@pytest.fixture
def origin() -> str:
    origins = get_settings().allowed_origins()
    if not origins:
        pytest.skip("FRONTEND_ORIGIN is blank, so no origin is permitted by design")
    return origins[0]


# --------------------------------------------------------------------------
# CORS
# --------------------------------------------------------------------------

async def test_preflight_for_a_bearer_endpoint_allows_the_authorization_header(client, origin):
    """Authorization is not CORS-safelisted: without it in Allow-Headers the
    browser never sends the real request at all."""
    r = await client.options("/productions", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    })

    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin
    allowed = {h.strip().lower() for h in r.headers["access-control-allow-headers"].split(",")}
    assert "authorization" in allowed
    assert "content-type" in allowed


async def test_preflight_for_the_sse_stream_allows_get(client, origin):
    r = await client.options("/productions/%s/events" % uuid.uuid4(), headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
    })

    assert r.status_code == 200
    assert "GET" in r.headers["access-control-allow-methods"]
    assert r.headers["access-control-allow-credentials"] == "true"
    assert r.headers["access-control-allow-origin"] == origin


async def test_preflight_allows_post_for_the_mutating_endpoints(client, origin):
    r = await client.options("/productions", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })

    assert r.status_code == 200
    assert "POST" in r.headers["access-control-allow-methods"]


async def test_actual_response_carries_the_credentialed_cors_headers(client, origin):
    """/auth/token needs no database, so this asserts the simple-request path."""
    r = await client.post("/auth/token", headers={"Origin": origin})

    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_the_allowed_origin_is_never_a_wildcard(client, origin):
    """A credentialed request with Access-Control-Allow-Origin: * is rejected by
    every browser, so the wildcard would silently break the whole frontend."""
    r = await client.post("/auth/token", headers={"Origin": origin})
    assert r.headers["access-control-allow-origin"] != "*"

    preflight = await client.options("/productions", headers={
        "Origin": origin, "Access-Control-Request-Method": "GET",
    })
    assert preflight.headers["access-control-allow-origin"] != "*"
    assert preflight.headers.get("vary", "").lower().find("origin") >= 0


async def test_an_unlisted_origin_is_not_echoed_back(client):
    r = await client.post("/auth/token", headers={"Origin": "http://evil.example"})
    assert r.headers.get("access-control-allow-origin") != "http://evil.example"


# --------------------------------------------------------------------------
# Auth guards on the two new endpoints (no session is opened before these fire)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/productions", "/productions/%s" % uuid.uuid4()])
async def test_new_endpoints_reject_a_missing_bearer_token(client, path):
    assert (await client.get(path)).status_code == 403


@pytest.mark.parametrize("path", ["/productions", "/productions/%s" % uuid.uuid4()])
async def test_new_endpoints_reject_an_invalid_bearer_token(client, path):
    r = await client.get(path, headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


async def test_detail_endpoint_rejects_a_non_uuid_production_id(client):
    r = await client.get("/productions/not-a-uuid",
                         headers={"Authorization": f"Bearer {issue_demo_token()}"})
    assert r.status_code == 422


# --------------------------------------------------------------------------
# build_summary - GET /productions rows
# --------------------------------------------------------------------------

def _production(**over) -> Production:
    defaults = dict(
        id=uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001"),
        producer_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        brief_text="Three-day commercial shoot in Lisbon with aerial coverage",
        budget_cap=Decimal("120000.00"),
        total_cost=Decimal("118450.50"),
        location="Lisbon",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 3),
        status="booked",
        current_step=10,
        created_at=NOW,
        updated_at=NOW,
    )
    return Production(**(defaults | over))


def test_summary_shape_is_exactly_the_documented_fields():
    row = build_summary(_production())

    assert set(row) == {
        "production_id", "status", "brief_text", "brief_truncated",
        "budget_cap", "total_cost", "created_at",
    }
    assert row["production_id"] == "aaaaaaaa-0000-0000-0000-000000000001"
    assert row["status"] == "booked"
    assert row["brief_truncated"] is False
    assert row["created_at"] == "2026-08-27T12:00:00+00:00"


def test_summary_money_is_an_exact_string_never_a_float():
    row = build_summary(_production(budget_cap=Decimal("120000.00"),
                                    total_cost=Decimal("0.05")))

    assert row["budget_cap"] == "120000.00"
    assert row["total_cost"] == "0.05", "a float round-trip would lose cents"
    assert isinstance(row["budget_cap"], str)


def test_summary_total_cost_is_null_before_step_seven():
    assert build_summary(_production(total_cost=None))["total_cost"] is None


def test_summary_truncates_a_long_brief_and_says_so():
    row = build_summary(_production(brief_text="x" * (BRIEF_PREVIEW_CHARS + 50)))

    assert row["brief_truncated"] is True
    assert row["brief_text"].endswith("...")
    assert len(row["brief_text"]) == BRIEF_PREVIEW_CHARS + 3


def test_truncate_brief_leaves_a_short_brief_untouched():
    assert truncate_brief("short", 100) == ("short", False)


# --------------------------------------------------------------------------
# build_detail - GET /productions/{id}
# --------------------------------------------------------------------------

REQUIREMENT_ID = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
OFFER_WIN = uuid.UUID("cccccccc-0000-0000-0000-000000000001")
OFFER_LOSE = uuid.UUID("cccccccc-0000-0000-0000-000000000002")
VENDOR_WIN = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
VENDOR_LOSE = uuid.UUID("dddddddd-0000-0000-0000-000000000002")
BOOKING_ID = uuid.UUID("eeeeeeee-0000-0000-0000-000000000001")
APPROVAL_ID = uuid.UUID("ffffffff-0000-0000-0000-000000000001")
CHECK_ID = uuid.UUID("99999999-0000-0000-0000-000000000001")
RECOVERY_ID = uuid.UUID("88888888-0000-0000-0000-000000000001")


def _audit(seq, actor, action, entity_type, entity_id, payload) -> AuditLog:
    return AuditLog(seq=seq, actor=actor, action=action, entity_type=entity_type,
                    entity_id=entity_id, payload=payload, created_at=NOW)


def _records() -> ProductionRecords:
    """A production that has been through every stage, built the way the agents
    actually write it - the audit payloads below are verbatim shapes from
    scout_agent, negotiation_agent, compliance_agent and recovery_agent."""
    production = _production()
    requirement = Requirement(id=REQUIREMENT_ID, production_id=production.id,
                              category="camera", spec={"role": "drone operator"},
                              quantity=2, priority=1, created_at=NOW)
    winner = Offer(id=OFFER_WIN, requirement_id=REQUIREMENT_ID, vendor_id=VENDOR_WIN,
                   price=Decimal("41000.00"), terms={"rush": True}, status="accepted",
                   round=2, is_winner=True, created_at=NOW)
    loser = Offer(id=OFFER_LOSE, requirement_id=REQUIREMENT_ID, vendor_id=VENDOR_LOSE,
                  price=Decimal("52000.00"), terms={}, status="rejected",
                  round=1, is_winner=False, created_at=NOW)
    vendors = {
        VENDOR_WIN: Vendor(id=VENDOR_WIN, name="Atlantic Aerials", category="camera",
                           rating=Decimal("4.70"), base_price=Decimal("45000.00"),
                           availability_calendar={"blocked": []},
                           contact_meta={"endpoint": "http://vendor-mock-1:9001"}),
        VENDOR_LOSE: Vendor(id=VENDOR_LOSE, name="Tagus Rigs", category="camera",
                            rating=Decimal("4.10"), base_price=Decimal("50000.00"),
                            availability_calendar={"blocked": []},
                            contact_meta={"endpoint": "http://vendor-mock-2:9002"}),
    }
    return ProductionRecords(
        production=production,
        requirements=[requirement],
        offers=[winner, loser],
        vendors=vendors,
        bookings=[Booking(id=BOOKING_ID, production_id=production.id, offer_id=OFFER_WIN,
                          final_price=Decimal("41000.00"), status="confirmed",
                          booked_at=NOW, created_at=NOW)],
        checks=[ComplianceCheck(id=CHECK_ID, production_id=production.id, booking_id=None,
                                check_type="licensing", status="fail",
                                evidence={"missing": ["drone operator"],
                                          "disclaimer": "MOCK DATA - not a real "
                                                        "regulatory check"},
                                created_at=NOW)],
        approvals=[Approval(id=APPROVAL_ID, production_id=production.id,
                            requested_by_agent="compliance-agent",
                            reason="compliance_failed", threshold_breached=False,
                            delta_amount=Decimal("-1549.50"),
                            producer_decision="approved", decided_at=NOW, created_at=NOW)],
        recovery_events=[RecoveryEvent(
            id=RECOVERY_ID, production_id=production.id, trigger="vendor_unavailable",
            affected_booking_id=BOOKING_ID, resolution_booking_id=None, status="resolved",
            timeline=[{"step": 1, "name": "find_replacement", "ts": NOW.isoformat(),
                       "detail": {"candidates": 2,
                                  "candidate_names": ["Tagus Rigs", "Belem Optics"]}}],
            created_at=NOW)],
        steps=[
            StepEvent(production_id=production.id, step=9, name="approval_gate",
                      status="done",
                      detail={"approval_required": True, "approval_id": str(APPROVAL_ID),
                              "reasons": ["compliance_failed"], "delta_amount": "-1549.50",
                              "delta_pct": -1.29},
                      ts=NOW, seq=40),
        ],
        audit=[
            _audit(10, "scout-agent", "find_vendors", "requirement", REQUIREMENT_ID, {
                "category": "camera", "considered": 2, "excluded": [],
                "offers": [
                    {"offer_id": str(OFFER_WIN), "vendor_id": str(VENDOR_WIN),
                     "vendor_name": "Atlantic Aerials", "price": "45000.00",
                     "terms": {}, "rank": 1, "available": True},
                    {"offer_id": str(OFFER_LOSE), "vendor_id": str(VENDOR_LOSE),
                     "vendor_name": "Tagus Rigs", "price": "52000.00",
                     "terms": {"fallback": True}, "rank": 2, "available": False},
                ],
            }),
            _audit(20, "negotiation-agent", "negotiation_round", "offer", OFFER_WIN, {
                "round": 1, "vendor_id": str(VENDOR_WIN), "vendor_name": "Atlantic Aerials",
                "offered": "40000.00", "conceded_terms": ["rush"],
                "rationale": "anchor is below the ask", "decision": "counter",
                "vendor_price": "43000.00", "vendor_message": "we can move a little",
            }),
            _audit(21, "negotiation-agent", "negotiation_round", "offer", OFFER_WIN, {
                "round": 2, "vendor_id": str(VENDOR_WIN), "vendor_name": "Atlantic Aerials",
                "offered": "41000.00", "conceded_terms": ["rush"],
                "rationale": "close the gap", "decision": "accept",
                "vendor_price": "41000.00", "vendor_message": "done",
            }),
            _audit(22, "negotiation-agent", "negotiation_walk_away", "offer", OFFER_LOSE, {
                "round": 1, "rationale": "above the market anchor",
            }),
            _audit(30, "negotiation-agent", "negotiate", "requirement", REQUIREMENT_ID, {
                "max_rounds": 3, "anchor": "44000.00", "winner": str(OFFER_WIN),
                "final_price": "41000.00", "settled": True, "settled_count": 1,
                "outcomes": [{"offer_id": str(OFFER_WIN), "settled": True}],
            }),
            _audit(35, "compliance-agent", "check_compliance", "production", production.id, {
                "checks": [{"check_type": "licensing", "status": "fail"}],
                "overall": "fail", "equipment_value": "41000.00",
            }),
            _audit(45, "producer", "approval_approved", "approval", APPROVAL_ID, {
                "production_id": str(production.id), "kind": "happy_path",
                "recovery_event_id": None, "reason_prefix_corroborates": False,
            }),
        ],
    )


def test_detail_top_level_keys_are_the_documented_contract():
    body = build_detail(_records())

    assert set(body) == {
        "production", "steps", "requirements", "compliance", "approvals",
        "bookings", "recovery_events", "failure", "unavailable",
    }


def test_detail_production_block():
    production = build_detail(_records())["production"]

    assert set(production) == {
        "production_id", "producer_id", "brief_text", "budget_cap", "total_cost",
        "location", "start_date", "end_date", "status", "current_step",
        "created_at", "updated_at",
    }
    assert production["budget_cap"] == "120000.00"
    assert production["total_cost"] == "118450.50"
    assert production["start_date"] == "2026-09-01", "a plain ISO date, not a datetime"
    assert production["current_step"] == 10


def test_detail_offers_carry_scouts_rank_and_availability_from_the_audit_payload():
    offers = build_detail(_records())["requirements"][0]["offers"]

    assert [o["rank"] for o in offers] == [1, 2], "ordered by scout's rank"
    assert offers[0]["available"] is True
    assert offers[1]["available"] is False
    assert offers[0]["vendor_name"] == "Atlantic Aerials"
    assert offers[0]["price"] == "41000.00", "the negotiated price, from the offers row"
    assert offers[0]["quoted_price"] == "45000.00", "the opening quote, from scout's payload"
    assert offers[0]["is_winner"] is True
    assert offers[0]["rounds_completed"] == 2


def test_detail_never_invents_a_vendor_score_breakdown():
    """score() is a sorted() key and is thrown away. The ordinal rank is the only
    thing that survives, so the breakdown must stay null and be explained."""
    body = build_detail(_records())

    for offer in body["requirements"][0]["offers"]:
        assert offer["score_breakdown"] is None
    assert "vendor_score_breakdown" in body["unavailable"]


def test_detail_reconstructs_round_by_round_negotiation_history():
    negotiation = build_detail(_records())["requirements"][0]["negotiation"]

    assert [r["round"] for r in negotiation["rounds"]] == [1, 2]
    assert negotiation["rounds"][0]["decision"] == "counter"
    assert negotiation["rounds"][1]["decision"] == "accept"
    assert negotiation["rounds"][1]["vendor_price"] == "41000.00"
    assert negotiation["rounds"][0]["rationale"] == "anchor is below the ask"
    assert negotiation["rounds"][0]["conceded_terms"] == ["rush"]
    # Rounds are audited against the OFFER; the run summary against the
    # REQUIREMENT. Both have to end up under the same requirement.
    assert negotiation["runs"][0]["winning_offer_id"] == str(OFFER_WIN)
    assert negotiation["runs"][0]["market_anchor"] == "44000.00"
    assert negotiation["terminal_events"][0]["event"] == "negotiation_walk_away"


def test_detail_negotiation_is_an_empty_shape_not_null_when_nothing_happened():
    """A stable shape means the frontend never needs a null check per requirement."""
    records = _records()
    bare = ProductionRecords(**{**records.__dict__, "audit": []})

    negotiation = build_detail(bare)["requirements"][0]["negotiation"]
    assert negotiation == {"runs": [], "rounds": [], "terminal_events": [], "failures": []}


def test_detail_compliance_reports_checks_and_the_audited_overall():
    compliance = build_detail(_records())["compliance"]

    assert compliance["overall"] == "fail", "only ever present in the audit payload"
    assert compliance["equipment_value"] == "41000.00"
    assert compliance["checks"][0]["check_type"] == "licensing"
    assert compliance["checks"][0]["evidence"]["missing"] == ["drone operator"]
    assert "MOCK DATA" in compliance["checks"][0]["evidence"]["disclaimer"]


def test_detail_has_no_compliance_documents_and_says_why():
    body = build_detail(_records())

    assert "documents" not in body["compliance"]
    assert "compliance_documents" in body["unavailable"]


def test_detail_approval_gets_delta_pct_from_the_step_payload():
    """delta_pct is not a column on approvals - it only ever exists in the
    step-9 detail or the recovery timeline's gate entry."""
    approval = build_detail(_records())["approvals"][0]

    assert approval["approval_id"] == str(APPROVAL_ID)
    assert approval["delta_amount"] == "-1549.50"
    assert approval["delta_pct"] == -1.29
    assert approval["reasons"] == ["compliance_failed"]
    assert approval["kind"] == "happy_path", "from the producer's decision audit row"
    assert approval["producer_decision"] == "approved"


def test_detail_bookings_are_joined_back_to_vendor_and_requirement():
    booking = build_detail(_records())["bookings"][0]

    assert booking["booking_id"] == str(BOOKING_ID)
    assert booking["final_price"] == "41000.00"
    assert booking["vendor_name"] == "Atlantic Aerials"
    assert booking["requirement_id"] == str(REQUIREMENT_ID)
    assert booking["status"] == "confirmed"


def test_detail_recovery_exposes_the_real_timeline_but_no_options_list():
    body = build_detail(_records())
    event = body["recovery_events"][0]

    assert event["status"] == "resolved"
    assert event["timeline"][0]["name"] == "find_replacement"
    assert event["timeline"][0]["detail"]["candidate_names"] == ["Tagus Rigs", "Belem Optics"]
    assert "options" not in event, "recovery commits one swap; it offers no choice"
    assert "recovery_options" in body["unavailable"]


def test_detail_never_reports_a_risk_assessment():
    """Nothing in this system computes risk. Emitting a risk object would be
    pure invention, so it is reported as unavailable instead."""
    body = build_detail(_records())

    assert "risk_assessment" not in body
    assert "risk" not in body["production"]
    assert "risk_assessment" in body["unavailable"]


def test_unavailable_explains_every_uncaptured_field():
    body = build_detail(_records())

    assert body["unavailable"] == NEVER_CAPTURED
    for name, reason in body["unavailable"].items():
        assert isinstance(reason, str) and len(reason) > 40, f"{name} needs a real reason"


def test_detail_survives_a_production_with_nothing_recorded_yet():
    """A brief submitted a second ago has no requirements, offers or audit rows.
    The frontend must still get every key, with empty collections."""
    production = _production(status="draft", current_step=0, total_cost=None)
    body = build_detail(ProductionRecords(
        production=production, requirements=[], offers=[], vendors={}, bookings=[],
        checks=[], approvals=[], recovery_events=[], steps=[], audit=[],
    ))

    assert body["production"]["total_cost"] is None
    assert body["requirements"] == []
    assert body["bookings"] == []
    assert body["approvals"] == []
    assert body["recovery_events"] == []
    assert body["compliance"] == {"overall": None, "equipment_value": None, "checks": []}
    assert body["failure"] is None
    assert body["steps"] == []


def test_detail_surfaces_a_pipeline_failure_reason():
    records = _records()
    failed = ProductionRecords(**{
        **records.__dict__,
        "audit": [_audit(99, "orchestrator", "pipeline_failed", "production",
                         records.production.id,
                         {"step": 6, "reason": "negotiation agent unreachable"})],
    })

    assert build_detail(failed)["failure"] == {
        "ts": NOW.isoformat(), "step": 6, "reason": "negotiation agent unreachable",
    }


def test_detail_is_json_serialisable_with_no_decimals_or_datetimes_left():
    """FastAPI would coerce these, but a Decimal would become a lossy float. Prove
    every money value has already been stringified by the assembler."""
    import json

    json.dumps(build_detail(_records()))  # raises TypeError if anything leaked
