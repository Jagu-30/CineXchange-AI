# CineXchange Orchestrator API — frontend contract

Base URL: `http://localhost:8000` (compose default). All endpoints except `POST /auth/token` and
`GET /healthz` require `Authorization: Bearer <token>` from `POST /auth/token`.

Source of truth for the shapes below: `services/orchestrator/main.py` (routes),
`services/orchestrator/pipeline.py` (the `STEPS` tuple and status transitions),
`cinex/steps.py` (the SSE/audit event shape), `cinex/auth.py` (auth behaviour), and the live
OpenAPI document at `GET /openapi.json`. Design intent: `docs/superpowers/specs/2026-08-19-cinexchange-backend-design.md` §7.

**Capture status.** Every example below except the two marked *(illustrative, not captured)* was
copied verbatim from a live call against the running compose stack on 2026-08-27. `GEMINI_API_KEY`
is not configured in this environment, so no production has completed a full 10-step run; the two
illustrative examples are constructed from `pipeline.py` / `services/recovery_agent/main.py`
source, not from a live response, and are labelled as such. Do not treat them as verified output.

---

## Authentication

**A request to any endpoint below other than `/auth/token` and `/healthz` that omits the
`Authorization` header returns `403`, not `401`.** `401` is reserved for a header that *is* present
but carries an invalid or expired token (`cinex/auth.py:verify_token`). This is deliberate and
tested (`tests/test_auth.py`) — do not treat a 403 during development as "not logged in yet" only;
check first whether the header was sent at all.

Captured:

```
$ curl -i http://localhost:8000/productions/00000000-0000-0000-0000-000000000000/status
HTTP/1.1 403 Forbidden
content-type: application/json

{"detail":"Not authenticated"}
```

---

## `POST /auth/token`

Issues a stub JWT for the single demo producer. No body.

Captured response:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJleHAiOjE3ODc4OTc4MDQsImlzcyI6ImNpbmV4Y2hhbmdlLWRlbW8ifQ.2WZ-BglGwVQHefYOAGE6Y8Bw1Jtn5LLdyervXaMNhpo",
  "token_type": "bearer"
}
```

Token is a JWT with claims `sub` (the demo producer's fixed UUID) and `exp` (24h). There is exactly
one producer identity in this build — no signup/login flow.

---

## `POST /productions`

Kicks off the 10-step happy path as a background task and returns immediately with **202**.

Request body:

```json
{
  "brief_text": "3-day commercial shoot in Lisbon, two camera crews, drone work, needs permits and insurance",
  "budget_cap": "120000.00",
  "location": "Lisbon",
  "start_date": "2026-09-01",
  "end_date": "2026-09-03"
}
```

`brief_text` must be at least 10 characters. `budget_cap` is a decimal string or number.

Captured response (`202 Accepted`):

```json
{"production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f", "status": "draft"}
```

Poll `GET /productions/{id}/status` or subscribe to `GET /productions/{id}/events` to follow
progress. Nothing else in the request/response shape depends on whether the pipeline ultimately
succeeds — a failed run still returns 202 here, because failure is discovered async.

---

## `GET /productions/{id}/status`

Snapshot of a production: overall status, current step number, running totals, whether an approval
is pending, and every step-transition row recorded so far. Reads the same DB projection as the SSE
stream — the two can never disagree.

Captured response (this production failed at step 2, `decompose`, because `GEMINI_API_KEY` is
empty in this environment — the shape is real, the specific failure is an artifact of that missing
key, not a bug):

```json
{
  "production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
  "status": "failed",
  "current_step": 2,
  "total_cost": null,
  "budget_cap": "120000.00",
  "pending_approval_id": null,
  "steps": [
    {"step": 1, "name": "ingest", "status": "in_progress", "detail": {}, "ts": "2026-08-27T06:16:57.073559+00:00"},
    {"step": 1, "name": "ingest", "status": "done", "detail": {"brief_chars": 91}, "ts": "2026-08-27T06:16:57.091766+00:00"},
    {"step": 2, "name": "decompose", "status": "in_progress", "detail": {}, "ts": "2026-08-27T06:16:57.125062+00:00"},
    {"step": 2, "name": "decompose", "status": "failed",
     "detail": {"reason": "producer.decompose_brief failed: Error calling tool 'decompose_brief': No API key was provided. Please pass a valid API key. Learn how to create an API key at https://ai.google.dev/gemini-api/docs/api-key."},
     "ts": "2026-08-27T06:16:57.476792+00:00"}
  ]
}
```

On a completed happy-path run, `steps` grows to cover all 10 entries in the `STEPS` table below
(each step gets an `in_progress` row and a `done` row; step 10 additionally gets a `terminal` row —
see the SSE section), `total_cost` is populated once step 7 runs, and `pending_approval_id` is set
whenever the production is parked at `awaiting_approval` — *(this paragraph describes behaviour
read from `pipeline.py`; it has not been observed end to end in this environment)*.

`404` if the production id does not exist.

---

## `GET /productions/{id}/events`

Server-Sent Events stream of step transitions, backed by the identical projection `/status` reads.
No request body. Each `step` event mirrors one `audit_log` row; the stream ends with an `event: end`
carrying the terminal production status, or after `SSE_MAX_SECONDS` (300s) of no terminal state.

### SSE event schema

```
event: step
data: {"production_id": "...", "seq": 15, "step": 1, "name": "ingest",
       "status": "done", "detail": {...}, "ts": "2026-08-27T06:16:57.091766+00:00"}
```

Fields, exactly: `production_id`, `seq`, `step`, `name`, `status`, `detail`, `ts`.
`seq` is the monotonic `audit_log.seq` — use it as the ordering/dedup key, not `ts` (§4 of the
spec: rows written in the same DB transaction can share a timestamp).

`status` is one of `in_progress`, `done`, `failed`, `terminal`. `terminal` is emitted once, on the
final step, and is a distinct value from `done` so that "one `done` row per step" stays a reliable
invariant for a consumer counting completed steps; its `detail` carries the outcome
(`{"terminal": "booked"}` on success — see `pipeline.py::_book`).

Captured stream (same failed run as above — real bytes, off the wire):

```
event: step
data: {"production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f", "step": 1, "name": "ingest", "status": "in_progress", "detail": {}, "ts": "2026-08-27T06:16:57.073559+00:00", "seq": 14}

event: step
data: {"production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f", "step": 1, "name": "ingest", "status": "done", "detail": {"brief_chars": 91}, "ts": "2026-08-27T06:16:57.091766+00:00", "seq": 15}

event: step
data: {"production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f", "step": 2, "name": "decompose", "status": "in_progress", "detail": {}, "ts": "2026-08-27T06:16:57.125062+00:00", "seq": 16}

event: step
data: {"production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f", "step": 2, "name": "decompose", "status": "failed", "detail": {"reason": "producer.decompose_brief failed: Error calling tool 'decompose_brief': No API key was provided...."}, "ts": "2026-08-27T06:16:57.476792+00:00", "seq": 18}

event: end
data: {"status": "failed"}
```

Only steps 1-2 appear because the run died there for lack of an API key. Steps 3-10 are real code
paths (see the `STEPS` table) but no live stream reaching them has been captured in this
environment.

---

## `GET /productions/{id}/trace`

Every `audit_log` row for the production, in `seq` order, across all agents — "prove this isn't
scripted." Includes both the ten step-transition rows and every other decision (e.g. one row per
negotiation round; `docs` spec §12 notes `audit_log` holds more rows than the 10 step transitions).

Captured response (same failed run):

```json
{
  "production_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
  "entries": 6,
  "actors": ["orchestrator", "producer"],
  "trace": [
    {"ts": "2026-08-27T06:16:57.065445+00:00", "actor": "producer", "action": "submit_brief",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"location": "Lisbon", "budget_cap": "120000.00"}},
    {"ts": "2026-08-27T06:16:57.073559+00:00", "actor": "orchestrator", "action": "step.ingest.in_progress",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"name": "ingest", "step": 1, "detail": {}, "status": "in_progress"}},
    {"ts": "2026-08-27T06:16:57.091766+00:00", "actor": "orchestrator", "action": "step.ingest.done",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"name": "ingest", "step": 1, "detail": {"brief_chars": 91}, "status": "done"}},
    {"ts": "2026-08-27T06:16:57.125062+00:00", "actor": "orchestrator", "action": "step.decompose.in_progress",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"name": "decompose", "step": 2, "detail": {}, "status": "in_progress"}},
    {"ts": "2026-08-27T06:16:57.464470+00:00", "actor": "orchestrator", "action": "pipeline_failed",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"step": 2, "reason": "producer.decompose_brief failed: ... No API key was provided..."}},
    {"ts": "2026-08-27T06:16:57.476792+00:00", "actor": "orchestrator", "action": "step.decompose.failed",
     "entity_type": "production", "entity_id": "c15c0e74-e26d-4935-aaa5-b3feadac103f",
     "payload": {"name": "decompose", "step": 2, "detail": {"reason": "..."}, "status": "failed"}}
  ]
}
```

On a completed run `actors` would include all five agents plus `orchestrator`/`producer`, per the
table-ownership rule in spec §4.

`404` if the production id does not exist.

---

## `POST /productions/{id}/recovery`

Triggers the 7-step emergency recovery for one booking on an already-processed production.

Request body:

```json
{"booking_id": null, "trigger": "vendor_unavailable"}
```

`booking_id` is optional — omit it and the orchestrator recovers the most expensive `confirmed`
booking. `trigger` defaults to `"vendor_unavailable"` if omitted entirely.

Captured response when the production has no confirmed booking yet (the only case reachable without
an API key — this is real, not illustrative):

```
HTTP/1.1 409 Conflict
{"detail": "no confirmed booking to recover"}
```

If a recovery is already in flight for the production (`recovery_events.status` in `pending`,
`in_progress`, `awaiting_approval`), the endpoint returns the existing event unchanged instead of
starting a second one — the idempotency guarantee from spec §9:

```json
{"recovery_event_id": "...", "timeline": [...], "outcome": "already_in_progress"}
```

*(illustrative, not captured — requires an existing in-flight recovery to trigger)*

On a fresh trigger, the response is whatever `recovery-agent`'s `recover` MCP tool returns —
`{"recovery_event_id": ..., "timeline": [...], "outcome": ...}`, `outcome` being `"booked"` or
`"awaiting_approval"`. Each `timeline` entry has `step` (1-7), `name`, `ts`, `detail`:

| step | name | actor work |
|---|---|---|
| 1 | `find_replacement` | re-invoke Scout, same requirement, excluding the failed vendor |
| 2 | `negotiate_replacement` | re-invoke Negotiation against the replacement |
| 3 | `recalculate_cost` | sum confirmed bookings + replacement |
| 4 | `check_schedule` | replacement availability vs. existing confirmed bookings |
| 5 | `update_records` | re-run insurance/permit checks against the new vendor |
| 6 | `present_diff` | structured old-vs-new booking diff |
| 7 | `approval_gate` | `evaluate_approval` against the pre-recovery `total_cost` baseline |

*(illustrative, not captured — a full recovery run requires a completed happy-path booking first,
which requires `GEMINI_API_KEY`)*

---

## `POST /approvals/{id}/decide`

Resumes (or halts) a production parked at `awaiting_approval`.

Request body:

```json
{"decision": "approved"}
```

`decision` must be exactly `"approved"` or `"rejected"`.

Captured response for an unknown approval id (real, captured):

```
HTTP/1.1 404 Not Found
{"detail": "unknown approval"}
```

`409` if the approval was already decided (`{"detail": "already decided"}`) — read from
`services/orchestrator/main.py`, not captured live (requires a prior decision to already exist).

On success: `{"approval_id": ..., "decision": ..., "production_id": ...}`. `"approved"` resumes the
pipeline at step 10 (booking) as a background task — the original brief is never resubmitted.
`"rejected"` marks the production `failed` and books nothing.
*(illustrative, not captured — requires a production to have reached `awaiting_approval`)*

---

## `GET /healthz`

Liveness for the orchestrator, plus reachability of all five agents and their exact MCP tool lists
— a judge-facing artifact per spec §5. Every agent, vendor mock, and the orchestrator itself expose
their own `GET /healthz` too (see `tests/test_healthz.py` for the full port map).

Captured response:

```json
{
  "ok": true,
  "agents": {
    "producer": ["decompose_brief"],
    "scout": ["find_vendors"],
    "negotiation": ["negotiate"],
    "compliance": ["check_compliance", "request_approval"],
    "recovery": ["recover"]
  }
}
```

If an agent is unreachable, its entry becomes the string `"unreachable: <error>"` instead of a list
— `ok` still reports `true` at the top level (health reports, it does not raise); a frontend health
dashboard should treat any non-list agent value as down.

---

## `productions.status` enum

| Value | Meaning |
|---|---|
| `draft` | Row created, pipeline not yet started |
| `decomposing` | Step 2, Producer Agent running |
| `scouting` | Steps 3-5, Scout Agent running |
| `negotiating` | Step 6, Negotiation Agent running |
| `compliance` | Step 8, Compliance Agent running |
| `awaiting_approval` | Parked at step 9, waiting on `POST /approvals/{id}/decide` |
| `booked` | Step 10 complete, bookings created |
| `recovering` | A recovery run is in progress against this production |
| `failed` | Pipeline (or recovery) failed, or an approval was rejected |

Source: `docs/superpowers/specs/2026-08-19-cinexchange-backend-design.md` §4; every value confirmed
present in `services/orchestrator/pipeline.py` and `services/recovery_agent/main.py`.

## Step `status` values (per-step, in `/status`'s `steps[]` and every SSE `step` event)

`in_progress`, `done`, `failed`, `terminal` — see the SSE section above for what distinguishes
`terminal` from `done`.

## `STEPS` — the 10-step happy path (`services/orchestrator/pipeline.py`)

| # | name | Actor |
|---|---|---|
| 1 | `ingest` | Orchestrator |
| 2 | `decompose` | Producer Agent |
| 3 | `discover` | Scout Agent |
| 4 | `solicit` | Scout Agent |
| 5 | `shortlist` | Scout Agent |
| 6 | `negotiate` | Negotiation Agent |
| 7 | `total` | Orchestrator |
| 8 | `compliance` | Compliance Agent |
| 9 | `approval_gate` | Compliance Agent |
| 10 | `book` | Orchestrator |

Steps 3, 4, 5 are emitted as three distinct step events around one `find_vendors` MCP call (spec
§5.2/§8 note) — the underlying trace shows a single `find_vendors` audit entry, not three round
trips.

## Recovery timeline `name` mapping (`services/recovery_agent/main.py::STEP_NAMES`)

See the table under `POST /productions/{id}/recovery` above.
