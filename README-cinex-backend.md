# CineXchange AI

CineXchange AI converts a film producer's raw, natural-language production brief into a
procured, compliance-checked shoot plan — decomposing the brief, sourcing and negotiating with
vendors, and booking — autonomously, pausing for a human decision only at defined risk gates (cost
overrun, failed compliance check, or an unfulfilled requirement). Five specialist agents
(producer, scout, negotiation, compliance, recovery) each expose one MCP tool surface and are
driven by an orchestrator as an explicit ten-step sequence, not a single prompt pretending to be
five agents. An emergency-recovery path re-sources a specific booking when a vendor goes dark
mid-production, in seven steps, without ever requiring the original brief to be resubmitted.

Full design: [`docs/superpowers/specs/2026-08-19-cinexchange-backend-design.md`](docs/superpowers/specs/2026-08-19-cinexchange-backend-design.md).
Build plan and task-by-task history: [`docs/superpowers/plans/2026-08-19-cinexchange-backend.md`](docs/superpowers/plans/2026-08-19-cinexchange-backend.md).
Frontend API contract: [`docs/API.md`](docs/API.md).

**Compliance and vendor data in this build are entirely mock.** `compliance-agent` checks permits,
insurance, and crew credentials against small hardcoded/in-process registries labelled
`evidence.source` in every check row — nothing here calls a real municipal permit office, a real
insurer, or a real licensing body. The three `vendor-mock` services simulate vendor quoting and
negotiation behaviour with a deterministic per-vendor policy derived from the vendor's UUID; they
are not connected to any real marketplace. This is a hackathon MVP, not a production integration.

---

## Architecture

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

One monorepo, one Docker image, one `docker build`, seven containers (plus Postgres and
ClickHouse) — each service is its own process, and every agent-to-agent call is a real network
hop, not an in-process function call. Vendor mocks speak plain REST rather than MCP on purpose:
they are external counterparties, and the protocol boundary keeps agent-to-agent traffic visibly
distinct from agent-to-vendor traffic in the logs. See spec §3 for the full repository layout and
table-ownership rules.

---

## Run it

### Prerequisites

- Docker Desktop (Compose v2)
- [`uv`](https://docs.astral.sh/uv/) for local (non-container) commands, e.g. tests
- A Gemini API key — **required**. Nothing runs end to end without one; there is no stub LLM
  adapter (spec §2). Tests inject fake LLM responses at the pytest fixture boundary, but the live
  compose stack always calls the real Gemini API.

### Start the stack

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY=<your key>
docker compose up -d --build
docker compose exec orchestrator python -m seeds.seed
```

The seed script is idempotent — it inserts the ~15 vendors in `seeds/vendors.json` across six
categories (camera, crew, location, transport, insurance, permit) if they are not already present,
and does nothing otherwise.

Postgres is published on **host port 5433**, not 5432 — a native PostgreSQL service already owns
5432 on the machine this was built on. Inside the compose network every service still reaches
`postgres:5432` normally (see the comment in `docker-compose.yml`); only host-side tooling (a
`psql` you run yourself, a host-side test DSN) needs port 5433.

Verify everything is up:

```bash
curl http://localhost:8000/healthz
```

`ok: true` plus every agent's exact MCP tool list. See [`docs/API.md`](docs/API.md) for the full
shape.

### Demo scripts

Three scripts in `scripts/`, run from the repo root with the stack up:

- **`./scripts/reset_demo.sh`** — truncates every transactional table (`productions`,
  `requirements`, `offers`, `bookings`, `compliance_checks`, `approvals`, `recovery_events`,
  `audit_log`) but **not** `vendors`, and re-enables every vendor on all three vendor-mock
  instances (undoing any `POST /admin/vendors/{id}/disable` calls). Run this between rehearsals —
  no re-seed needed.
- **`./scripts/demo_happy_path.sh`** — gets a token, submits `scripts/brief.json` to
  `POST /productions`, and streams `GET /productions/{id}/events` (SSE) to the terminal until the
  production reaches a terminal state. Saves the production id to `.last_production_id`.
- **`./scripts/demo_recovery.sh [production_id]`** — takes a production id (or reads
  `.last_production_id`), and triggers `POST /productions/{id}/recovery`. Intended to run after a
  booked production and after disabling that production's booked vendor via the vendor mock's
  admin endpoint, so recovery reacts to a genuine `503`, not a flag.

Typical rehearsal:

```bash
./scripts/reset_demo.sh
time ./scripts/demo_happy_path.sh
./scripts/demo_recovery.sh
```

**This has not been rehearsed end to end in this environment.** `GEMINI_API_KEY` is empty here, so
`demo_happy_path.sh` reliably reaches step 2 (`decompose`) and then fails with "No API key was
provided" — confirmed live, see the captured trace in [`docs/API.md`](docs/API.md). Every part of
the pipeline that does **not** require the LLM (auth, production creation, status, SSE, trace,
healthz, the recovery 409 path, the approval 404 path) has been exercised against the live stack
and is documented with real captured output in `docs/API.md`. Steps 3-10 of the happy path and the
full recovery flow are implemented and unit/service-tested (see `tests/`) but have **not** been
observed end to end against the live stack, because that requires a working Gemini key. To
complete a real run: set `GEMINI_API_KEY` in `.env`, restart the affected containers
(`docker compose up -d --build`), then run the rehearsal above. `NEGOTIATION_MAX_ROUNDS` is
pre-frozen at `3` in `.env.demo` (spec §9); if a real timed run exceeds 90 seconds, drop it to `2`
there and re-measure — this has not been necessary to decide yet, since no timed run exists.

### Run the tests

```bash
export PATH="$HOME/.local/bin:$PATH"   # if uv is not already on PATH
uv run pytest -q                        # everything except live-stack integration tests still runs
uv run pytest -v -m integration         # requires `docker compose up -d` and a seeded DB
```

Unit and service-level tests spin up their own DB against `TEST_DATABASE_URL`
(`postgresql+asyncpg://cinex:cinex@localhost:5433/cinex_test` by default — note **host port 5433**,
matching the Postgres port note above) and override the Gemini client with a fixture, so they do
not need `GEMINI_API_KEY` or the compose stack. Tests marked `integration`
(`tests/test_integration_happy_path.py`, `tests/test_integration_recovery.py`,
`tests/test_healthz.py`) talk to the live compose stack over `localhost` and are skipped unless you
pass `-m integration` explicitly.

As of this task: 107 pre-existing tests pass (5 skipped), plus the 10 new tests in
`tests/test_healthz.py` (all passing against the live stack). See
`.superpowers/sdd/2026-08-19-cinexchange-backend/task-22-report.md` for the full run log.

---

## Repository layout

See spec §3 for the authoritative layout; in short: `cinex/` is the shared library imported by
every service (config, structured logging, auth, audit, HTTP client with the vendor-timeout
fallback, ClickHouse writer, MCP client, ORM models); `services/` holds the seven entrypoints
(orchestrator, five agents, vendor mock) sharing one Docker image selected by the `SERVICE` env
var; `seeds/` holds the demo vendor and brief fixtures; `tests/` is unit, service-level (in-process
ASGI transport against each agent's MCP tools), and integration (against the live compose stack).
