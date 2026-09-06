# CineXchange AI — tools and technologies

Everything actually used in the root-level backend and its frontend, with
versions read from `pyproject.toml`, `package.json` and the deployed
environment rather than from memory.

Scope note: this covers the **root** implementation (`cinex/`, `services/`,
`app/`, `lib/`). The separate backend under `backend/` is a different
implementation by another author and has its own dependency set.

---

## Backend — Python 3.11

| | Version | Role |
|---|---|---|
| ☑ FastAPI | 0.141.1 | HTTP surface for the orchestrator, all five agents, and the vendor mocks |
| ☑ Uvicorn | 0.52.4 | ASGI server, `[standard]` extras |
| ☑ FastMCP | 3.4.7 | MCP server in each agent; the orchestrator is an MCP client |
| ☑ mcp | 1.29.0 | Model Context Protocol runtime underneath FastMCP |
| ☑ google-genai | 2.19.0 | Gemini access — both the API-key and Vertex AI paths |
| ☑ SQLAlchemy | 2.0.52 | Async ORM, `[asyncio]` extras |
| ☑ asyncpg | 0.31.0 | PostgreSQL driver |
| ☑ clickhouse-connect | 1.7.1 | Analytics write-through |
| ☑ Pydantic | 2.13.4 | Schemas, and LLM structured output via `response_schema` |
| ☑ pydantic-settings | 2.15.0 | Typed config from `.env` |
| ☑ httpx | 0.28.1 | Agent → vendor HTTP, with timeout and single retry |
| ☑ python-jose | 3.5.0 | Stub JWT for the single demo producer |

**Dev:** ☑ pytest 9.1.1 · ☑ pytest-asyncio · ☑ anyio · ☑ uv (package manager)

---

## Frontend — Next.js

| | Version | Role |
|---|---|---|
| ☑ Next.js | 13.5.1 | App Router, 18 routes |
| ☑ React | 18.2.0 | |
| ☑ TypeScript | 5.2.2 | `tsc --noEmit` gate, 0 errors |
| ☑ Tailwind CSS | 3.3.3 | Styling, with `tailwindcss-animate` |
| ☑ Radix UI | 27 primitives | Accessible component base (shadcn/ui style) |
| ☑ lucide-react | 0.446.0 | Icons |
| ☑ Recharts | 2.12.7 | Charts |
| ☑ react-hook-form + zod | 7.53 / 3.23 | Forms and validation |
| ☑ EventSource | browser API | SSE consumer for live pipeline steps |

Present in `package.json` but **not used** by this implementation:
`@supabase/supabase-js`, `@netlify/plugin-nextjs` — they belong to the
original scaffold, not to the autonomous backend.

---

## Data

| | Role |
|---|---|
| ☑ PostgreSQL 16 | System of record: productions, requirements, vendors, offers, bookings, compliance_checks, approvals, recovery_events, audit_log |
| ☑ ClickHouse 24 (alpine) | Analytics write-through; feeds the negotiation market anchor |

Schema comes from SQLAlchemy `create_all()` plus an idempotent seed script.
No Alembic — deliberate, for a disposable demo database.

---

## AI

| | Detail |
|---|---|
| ☑ Gemini 2.5 Flash | Brief decomposition and per-round negotiation strategy |
| ☑ Vertex AI | Live path — authenticates via the VM's service account (ADC), no key in the deployment |
| ☑ Gemini Developer API | Fallback path, `GEMINI_API_KEY`, one env flag away |
| ☑ Structured output | Pydantic `response_schema`, with one repair retry on malformed JSON |
| ☑ Rate-limit handling | 429/503 backoff with jitter, plus a concurrency cap — one run makes 22–37 model calls |

---

## Infrastructure

| | Detail |
|---|---|
| ☑ Docker + Compose | 12 services from 2 images |
| ☑ Google Compute Engine | One `e2-standard-2` VM, Ubuntu 22.04, 40 GB disk, 4 GB swap |
| ☑ `compute.googleapis.com` | Enabled |
| ☑ `aiplatform.googleapis.com` | Enabled |
| ☑ Static external IP | Reserved, survives stop/start |
| ☑ VPC firewall | Only 8000 and 3000 open; Postgres and ClickHouse stay internal |
| ☑ IAM | `roles/aiplatform.user` on the VM service account |
| ☑ gcloud SDK | 582.0.0 |

### The 12 services

`orchestrator` · `producer-agent` · `scout-agent` · `negotiation-agent` ·
`compliance-agent` · `recovery-agent` · `vendor-mock-1/2/3` · `postgres` ·
`clickhouse` · `frontend`

---

## Tooling

| | Role |
|---|---|
| ☑ uv | Python dependency and venv management |
| ☑ npm | Frontend dependencies |
| ☑ Git | Pushed to two GitHub remotes |
| ☑ ffmpeg 9.0.1 | Encodes terminal-playback demo videos (h264) |
| ☑ Pillow 12.3.0 | Renders the frames those videos are built from |
| ☑ Bash + PowerShell | Deploy scripts and Windows-side tooling |

---

## Not used, and why

Worth being explicit — several of these appear in the original brief or in
sibling config, and their absence is a decision rather than an oversight.

| | Why not |
|---|---|
| ☒ Grafana / Prometheus | The brief listed monitoring as optional; never built. The monitoring page says so rather than faking numbers. |
| ☒ Alembic | Disposable demo database; `create_all()` plus seeds avoids model/migration drift. |
| ☒ Cloud Run / GKE | The five agents address each other by in-network DNS name; one VM running Compose preserves that with zero code changes. |
| ☒ Cloud SQL | Postgres runs as a container on the same VM. |
| ☒ Supabase / Netlify | Scaffold leftovers, unused by this implementation. |
| ☒ Real payments, insurance, permits | Explicitly out of scope. Compliance runs against mock registries and every evidence payload carries a `MOCK DATA` disclaimer. |
