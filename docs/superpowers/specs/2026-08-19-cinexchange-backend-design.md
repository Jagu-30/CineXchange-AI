# CineXchange AI — Backend Design

**Date:** 2026-08-19
**Status:** Approved
**Scope:** Hackathon MVP backend (3-day build, 3-minute live demo)

---

## 1. Purpose and success criteria

CineXchange AI converts a film producer's natural-language production brief into a procured,
compliance-checked shoot plan, autonomously, with human approval only at defined risk gates.

The build is done when all three hold:

1. `POST /productions` with a raw brief produces a full 10-step trace in `audit_log`, ending in
   `bookings` rows or an `approvals` row awaiting a producer decision.
2. `POST /productions/{id}/recovery` produces a complete 7-step `recovery_events.timeline` and
   either new `bookings` rows or a pending `approvals` row — with no endpoint requiring the
   original brief to be resubmitted.
3. Every number shown to the producer (cost delta, schedule impact) is computed from live DB
   state, never from a response template.

Build strictly in that order. A working happy path with a scripted recovery beats a half-working
version of both.

### Explicitly out of scope

Multi-tenant auth, real payments, real insurance/legal verification, per-layer rate limiting and
backoff gold-plating, and any feature not required by the 10-step or 7-step scenarios.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11, FastAPI, async throughout |
| Operational DB | PostgreSQL 16 |
| Analytics DB | ClickHouse (write-through, not system of record) |
| Agent transport | FastMCP streamable-HTTP, one MCP server per agent |
| Vendor transport | Plain REST (external counterparties) |
| LLM | Google Gemini, `responseSchema` structured output |
| Auth | Stub JWT, single demo producer |
| Deploy | Docker Compose, single node |
| Logging | Structured JSON to stdout |

**Decision: live LLM only, no stub adapter.** Nothing runs end-to-end without `GEMINI_API_KEY`.
Tests inject fake LLM responses at the pytest fixture boundary via dependency override — this is
test-time DI, not a shipped stub implementation.

**Risk accepted:** a network or provider outage during the pitch breaks the happy path. The
mitigation deliberately *not* built is a cached last-known-good decomposition keyed by brief hash.
Revisit only if day-3 time remains.

---

## 3. Service topology

One monorepo, one Docker image, seven entrypoints. Same dependency set, one `docker build`, seven
containers. Each service is its own process on its own host; every agent-to-agent call is a real
network hop.

```
  orchestrator :8000  (FastAPI + MCP client, persistent sessions)
        |
        |-- MCP --> producer-agent      :8001
        |-- MCP --> scout-agent         :8002 --REST--+
        |-- MCP --> negotiation-agent   :8003 --REST--+--> vendor-mock-1 :9001
        |-- MCP --> compliance-agent    :8004         +--> vendor-mock-2 :9002
        +-- MCP --> recovery-agent      :8005         +--> vendor-mock-3 :9003
                        |
                        +-- MCP --> scout-agent, negotiation-agent

  postgres :5432        clickhouse :8123 / :9000
```

Three vendor containers rather than one per vendor: each hosts several vendor personas across
categories, like competing brokerages. `vendors.contact_meta->>'endpoint'` holds the base URL, so
routing is data-driven and adding a vendor is a seed-row change.

Vendor mocks speak REST, not MCP, on purpose. They are external counterparties, and the protocol
boundary makes agent-to-agent traffic visibly distinct from agent-to-vendor traffic in the logs.

### Repository layout

```
CineXchange/
├── docker-compose.yml
├── Dockerfile                  # one image, entrypoint chosen by SERVICE env var
├── pyproject.toml              # uv-managed
├── .env.example
├── .env.demo                   # frozen demo settings
├── cinex/                      # shared library, imported by every service
│   ├── config.py               # pydantic-settings, all env vars
│   ├── logging.py              # structured JSON logger
│   ├── auth.py                 # stub JWT issue/verify + FastAPI dependency
│   ├── audit.py                # write_audit(actor, action, entity, payload)
│   ├── http.py                 # timeout + single-retry + fallback vendor client
│   ├── clickhouse.py           # async write-through + the two analytics queries
│   ├── mcp_client.py           # pooled FastMCP client sessions
│   ├── db/
│   │   ├── models.py           # SQLAlchemy 2.0 ORM
│   │   └── session.py          # async engine + session factory
│   ├── schemas/                # pydantic models shared across service boundaries
│   └── llm/
│       ├── gemini.py           # async client, responseSchema, timeout, one retry
│       └── prompts/
├── services/
│   ├── orchestrator/
│   ├── producer_agent/
│   ├── scout_agent/
│   ├── negotiation_agent/
│   ├── compliance_agent/
│   ├── recovery_agent/
│   └── vendor_mock/
├── seeds/
│   ├── vendors.json            # ~15 vendors across 6 categories, 3 endpoints
│   └── briefs.json             # demo briefs
└── tests/
```

**Schema management:** SQLAlchemy `create_all()` on orchestrator startup plus an idempotent seed
script. No Alembic — migration tooling is overhead for a 3-day build with a disposable DB, and it
introduces model/migration drift risk. Alembic is the documented swap-in for production.

---

## 4. Data model

All tables have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at`.

| Table | Columns beyond the standard three |
|---|---|
| `productions` | producer_id, brief_text, budget_cap NUMERIC, location, start_date, end_date, status, current_step INT, total_cost NUMERIC NULL |
| `requirements` | production_id FK, category, spec JSONB, quantity INT, priority INT |
| `vendors` | name, category, rating NUMERIC, base_price NUMERIC, availability_calendar JSONB, contact_meta JSONB |
| `offers` | requirement_id FK, vendor_id FK, price NUMERIC, terms JSONB, status, round INT, is_winner BOOL |
| `bookings` | production_id FK, offer_id FK, final_price NUMERIC, status, booked_at |
| `compliance_checks` | production_id FK NULL, booking_id FK NULL, check_type, status, evidence JSONB |
| `approvals` | production_id FK, requested_by_agent, reason, threshold_breached BOOL, delta_amount NUMERIC, producer_decision, decided_at |
| `recovery_events` | production_id FK, trigger, affected_booking_id FK, resolution_booking_id FK NULL, status, timeline JSONB |
| `audit_log` | seq BIGINT IDENTITY (ordering key), actor, action, entity_type, entity_id, payload JSONB |

### Status enums

| Field | Values |
|---|---|
| `productions.status` | `draft`, `decomposing`, `scouting`, `negotiating`, `compliance`, `awaiting_approval`, `booked`, `recovering`, `failed` |
| `offers.status` | `pending`, `negotiated`, `accepted`, `rejected`, `withdrawn` |
| `bookings.status` | `confirmed`, `cancelled`, `superseded` |
| `compliance_checks.status` | `pass`, `fail`, `pending` |
| `approvals.producer_decision` | `pending`, `approved`, `rejected` |
| `recovery_events.status` | `pending`, `in_progress`, `awaiting_approval`, `resolved`, `failed` |

### Indexes

- `offers (requirement_id, status)`
- `audit_log (entity_type, entity_id, seq)` and `audit_log (seq)`
  — ordering uses the monotonic `seq`, never `created_at`: Postgres `now()` is transaction-start
  time, so rows written in one transaction share it, and the tiebreak would be a random UUID.
- `bookings (production_id, status)`
- Partial unique on `recovery_events (production_id)` where status is one of
  `pending`, `in_progress`, `awaiting_approval` — this is the idempotency guarantee for a fumbled
  demo re-trigger.

### Table ownership

Agents share one Postgres but not tables. Strict ownership is what makes `audit_log` credible:
every row's `actor` is the process that actually made the decision.

| Writer | Owns |
|---|---|
| Orchestrator | `productions`, `bookings` |
| Producer Agent | `requirements` |
| Scout Agent | `offers` (insert) |
| Negotiation Agent | `offers` (status, price, round, is_winner) |
| Compliance Agent | `compliance_checks`, `approvals` |
| Recovery Agent | `recovery_events` |
| **every service** | `audit_log` — append-only, no exceptions |

---

## 5. Agent contracts

Each agent is a FastAPI app mounting a FastMCP streamable-HTTP server at `/mcp`, plus `GET /healthz`.
A `tools/list` call against any agent is a judge-facing artifact and must return exactly the tools
listed below.

### 5.1 Producer Agent — port 8001

```
decompose_brief(production_id, text, budget_cap, location, start_date, end_date)
  -> {requirements: [{category, spec, quantity, priority}]}
```

One Gemini call with a strict `responseSchema`. Categories constrained to
`camera | crew | location | transport | insurance | permit`. Never regex or keyword extraction —
the brief is unstructured natural language by design. Writes `requirements` rows and one
`audit_log` entry carrying the raw model output.

### 5.2 Marketplace Scout Agent — port 8002

```
find_vendors(requirement_id, exclude_vendor_ids=[])
  -> {offers: [{offer_id, vendor_id, price, terms, rank}]}
```

Queries `vendors` by category, calls each vendor's `GET /vendors/{id}/quote`, ranks by a weighted
score over price, rating, and availability fit. `exclude_vendor_ids` is what lets recovery re-scope
the same requirement while excluding the failed vendor. Inserts `offers` rows with `status=pending`.

### 5.3 Negotiation Agent — port 8003

```
negotiate(requirement_id, offer_ids, max_rounds)
  -> {winning_offer_id, final_price, rounds: [...]}
```

Real multi-round request/response against vendor processes. Per round, one Gemini call chooses the
strategy — price anchor, which terms to trade, whether to walk — given the current offer set, the
ClickHouse median market price for that category, and the round number. It has **no visibility into
any vendor's reservation price**.

Rounds within a requirement are sequential; requirements are negotiated concurrently via
`asyncio.gather` under a semaphore. Three rounds is therefore about three LLM calls deep, not
eighteen sequential.

Every round writes an `audit_log` entry with both sides' positions. The winner gets
`status=accepted, is_winner=true`; losers get `status=rejected`.

### 5.4 Compliance & Approval Agent — port 8004

```
check_compliance(production_id) -> {checks: [{check_type, status, evidence}], overall}
request_approval(production_id, reason, delta_amount, threshold_breached) -> {approval_id, status}
```

Rules-based against mock registries, clearly labelled as such in `evidence.source`. No LLM. Checks:

- **permit** — location shoots require a filming permit, validated against a mock municipal
  registry keyed by location and date range.
- **insurance** — total equipment value above `INSURANCE_RIDER_THRESHOLD` requires a rider.
- **licensing** — crew specs flagged `requires_certification` (drone operator, pyrotechnics,
  stunts) must carry a valid mock credential.

Approval routing is one pure function, `evaluate_approval(...)`, never prompt logic. Approval is
required when total cost exceeds `budget_cap`, **or** the percentage delta against baseline exceeds
`APPROVAL_THRESHOLD_PCT`, **or** any compliance check has status `fail`.

**Baseline is defined per path and is not inferred:**

- Happy path — baseline is the production's `budget_cap`.
- Recovery — baseline is the production's `total_cost` as recorded immediately before the recovery
  event began.

The same function serves both paths; only the baseline argument differs.

### 5.5 Emergency Recovery Agent — port 8005

```
recover(production_id, booking_id, trigger) -> {recovery_event_id, timeline, outcome}
```

Seven steps, matching the deck exactly. Each appends a timestamped entry to
`recovery_events.timeline` **as it completes**, so a mid-run failure still leaves a partial,
readable artifact.

1. **Find equivalent vendor** — re-invoke Scout over MCP, same `requirement_id`,
   `exclude_vendor_ids=[failed]`
2. **Negotiate with replacement** — re-invoke Negotiation over MCP
3. **Recalculate total production cost** — sum confirmed bookings plus the replacement
4. **Check schedule impact** — replacement's `availability_calendar` against existing confirmed
   bookings; report collisions
5. **Update insurance & logistics records** — re-run the insurance and permit checks against the
   new vendor
6. **Show producer the revised decision** — structured diff of old booking versus new (price,
   vendor, dates, terms)
7. **Request approval only if** the recalculated cost breaches `APPROVAL_THRESHOLD_PCT`

Step 7 calls the same `evaluate_approval` function as the happy path, with the recovery baseline
from section 5.4. Cost delta is the primary trigger, and a `fail` returned by step 5 also raises an
approval. This is deliberately a superset of the deck's cost-only wording: a recovery that silently
books an uninsured replacement would be worse than one that pauses.

Steps 1 and 2 are MCP calls to the same agents the happy path uses. No duplicated procurement
logic exists anywhere in the recovery agent.

---

## 6. Vendor mock services — ports 9001-9003

```
GET  /vendors/{vendor_id}/quote?requirement_id=&category=&quantity=&start=&end=
       -> {price, terms, available}
POST /vendors/{vendor_id}/negotiate
       {session_id, round, price, terms}
       -> {decision, price, terms, message}      decision: accept | counter | reject
POST /vendors/{vendor_id}/availability   -> {available, conflicts: [...]}
POST /admin/vendors/{vendor_id}/disable  -> marks the vendor unavailable (demo trigger)
GET  /healthz
```

### Negotiation policy

Each vendor's policy is derived deterministically from its UUID and **never leaves the vendor
process**:

```python
rng             = random.Random(vendor_id.int)   # full UUID - hex[:8] collides across a category
floor_pct       = rng.uniform(0.72, 0.88)   # reservation = base_price * floor_pct
concession_rate = rng.uniform(0.25, 0.55)   # fraction of remaining gap closed per round
bundle_appetite = rng.uniform(0.0, 1.0)     # willingness to trade terms for price
patience        = rng.randint(2, 4)         # rounds before it stops moving
```

Per-round decision, given the agent's offer and the vendor's current ask:

- offer at or above the reservation price → **accept**
- round beyond `patience` and offer below reservation → **reject**, holding firm; it never crosses
  the floor
- otherwise → **counter** at `ask - concession_rate * (ask - max(reservation, offer))`
- if the agent conceded a term (flexible dates, longer rental, bundled units) and
  `bundle_appetite > 0.5`, the effective reservation drops by 3.75-5% for that round

Session state is held in-process, keyed by `session_id`, and survives across the rounds of one
negotiation.

**Why this answers "prove it isn't fake":** the Negotiation Agent provably cannot see the floor —
it lives in a different process and is never transmitted. The demo can show a vendor refusing to
cross it. The `/admin/.../disable` endpoint makes the recovery demo react to a vendor that has
genuinely gone dark, not to a flag.

---

## 7. Orchestrator API

The written contract for the frontend teammate. Publish this on day one.

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/auth/token` | Issues a stub JWT for the single demo producer |
| `POST` | `/productions` | Body: brief_text, budget_cap, location, start_date, end_date. Returns **202** with production_id and status. Work runs as a background task. |
| `GET` | `/productions/{id}/status` | Snapshot: status, current_step, per-step state, totals, pending approval |
| `GET` | `/productions/{id}/events` | SSE stream of step transitions |
| `GET` | `/productions/{id}/trace` | Full ordered `audit_log` for the production — the "prove it isn't scripted" endpoint |
| `POST` | `/productions/{id}/recovery` | Body: booking_id, trigger. Triggers the 7-step recovery. |
| `POST` | `/approvals/{id}/decide` | Body: decision (approved or rejected). Resumes or halts the paused path. |
| `GET` | `/healthz` | Liveness, plus reachability of all five agents |

SSE and `/status` read the same DB projection, so they can never disagree. SSE is the demo feel;
polling is the fallback that survives hostile venue wifi.

### SSE event schema

```
event: step
data: {"production_id": "...", "step": 6, "name": "negotiate",
       "status": "in_progress", "detail": {}, "ts": "2026-08-19T12:00:00Z"}
```

`status` is one of `in_progress`, `done`, `failed`, `terminal`. The `terminal` row is the one the
SSE consumer closes on; it carries the outcome (`booked`, `awaiting_approval`, or `failed`) in
`detail`. It is a separate status rather than a second `done` so the step sequence stays exactly
one `done` per step.

---

## 8. The 10-step happy path

`POST /productions` returns 202 immediately; the orchestrator drives these as an explicit sequence
of agent tool calls. Not one giant prompt pretending to be five agents.

| # | Step | Actor |
|---|---|---|
| 1 | Ingest brief, create `productions` row | Orchestrator |
| 2 | Decompose brief into `requirements` | Producer Agent |
| 3 | Discover candidate vendors per requirement | Scout Agent |
| 4 | Solicit initial offers from vendor services | Scout Agent |
| 5 | Rank and shortlist per requirement | Scout Agent |
| 6 | Negotiate, up to 3 rounds, concurrent across requirements | Negotiation Agent |
| 7 | Select winners, compute total against `budget_cap` | Orchestrator |
| 8 | Run compliance checks | Compliance Agent |
| 9 | Approval gate if threshold breached | Compliance Agent |
| 10 | Create `bookings` rows | Orchestrator |

If step 9 raises an approval, the production parks at `awaiting_approval` and step 10 runs only
after `POST /approvals/{id}/decide` returns `approved`. A rejection moves the production to
`failed` and books nothing.

---

## 9. Non-functional requirements

### Latency

Full happy path well under 3 minutes, with visible incremental progress. Budget: decomposition is
one LLM call (~5s), negotiation is about three LLM calls deep after concurrent fan-out (~15s),
everything else is DB and local HTTP. No single opaque long-running call.

### Frozen demo settings

`NEGOTIATION_MAX_ROUNDS` is env-configurable and **frozen at 3 in `.env.demo`**. It is not a live
variable during the pitch.

### Vendor timeout fallback

Every vendor call gets a `VENDOR_TIMEOUT_S` timeout and one retry, then falls back to the vendor's
`base_price` from Postgres as a list-price offer tagged `terms.fallback = true` and logged to
`audit_log`. The demo degrades instead of stopping — and it degrades honestly, because the fallback
is visible in the trace.

Implemented once in `cinex/http.py` and reused. Not gold-plated per layer.

### Idempotency

The partial unique index on in-progress `recovery_events` means a re-triggered recovery returns the
existing event rather than forking state. `POST /productions/{id}/recovery` checks
`recovery_events.status` before doing anything.

### Auditability

Every agent decision writes to `audit_log`. `GET /productions/{id}/trace` returns the whole ordered
trace in one payload.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none | required |
| `GEMINI_MODEL` | pinned in `.env.example` during step 1 of the build order | model id; the value is read from the live Gemini models list rather than hardcoded from memory |
| `APPROVAL_THRESHOLD_PCT` | `10` | human-in-the-loop gate |
| `NEGOTIATION_MAX_ROUNDS` | `3` | frozen at 3 for the demo |
| `VENDOR_TIMEOUT_S` | `5` | per vendor HTTP call |
| `LLM_TIMEOUT_S` | `30` | per Gemini call |
| `INSURANCE_RIDER_THRESHOLD` | `50000` | compliance rule; parsed as `Decimal` |
| `SERVICE` | none | selects the entrypoint in the shared image |
| `DATABASE_URL`, `CLICKHOUSE_URL`, `JWT_SECRET` | none | infra |

---

## 10. ClickHouse

Thin write-through, two queries that are load-bearing rather than decorative.

- An `events` table fed asynchronously from the same writes that produce `audit_log` and `offers`.
  Fire-and-forget; a ClickHouse failure never blocks the operational path.
- **Query 1, median market price per category.** Consumed by the Negotiation Agent as its opening
  anchor. This makes ClickHouse part of the decision loop, not a side-car.
- **Query 2, cost-delta history per production.** Consumed by the recovery diff at step 6.

---

## 11. Error handling

| Failure | Response |
|---|---|
| Gemini timeout or malformed JSON | One retry with a repair instruction, then fail the step and mark the production `failed` with the reason in `audit_log` |
| Vendor timeout | Retry once, then fall back to a `base_price` offer tagged `terms.fallback=true` |
| Vendor rejects all rounds | Requirement resolves to the best standing offer; if none exists, the requirement is flagged unfulfilled and forced into the approval gate |
| No vendors found for a category | Compliance raises an approval with reason `unfulfilled_requirement` |
| Agent unreachable over MCP | Orchestrator fails the step, records it, and surfaces it on SSE. No silent skip. |
| Recovery re-triggered | Returns the existing in-progress `recovery_events` row unchanged |

Nothing fails silently. Every failure path writes to `audit_log` and emits an SSE event.

---

## 12. Testing

Lean, weighted toward the logic most likely to be wrong.

- **Unit, fast, no I/O:** vendor concession policy across rounds and seeds, including that it never
  crosses its reservation; `evaluate_approval` threshold math; compliance rule evaluation; schedule
  collision detection; cost recalculation.
- **Service-level:** each agent's MCP tools via in-process ASGI transport, with the Gemini client
  overridden by a fixture returning recorded responses.
- **Integration:** one full happy-path run against Docker Compose asserting all 10 step transitions
  occurred in order, that `audit_log` carries entries authored by all five agent actors, and that
  the production reached a terminal state. One recovery run asserting a 7-entry
  `recovery_events.timeline` and confirming the original brief is never resubmitted.

Note that `audit_log` holds many more than 10 rows on a successful run — each negotiation round
writes its own entry. The 10 in criterion 1 refers to step transitions, not row count.

---

## 13. Build order

1. Skeleton — compose, shared image, DB models, seeds, auth stub, health checks
2. Happy path, steps 1 through 10, fully real, end to end
3. Recovery, all 7 steps
4. ClickHouse write-through and the two queries
5. Polish — SSE, trace endpoint, structured logging, demo rehearsal

No recovery work begins until criterion 1 in section 1 passes end to end.
