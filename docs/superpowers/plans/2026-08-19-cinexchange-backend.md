# CineXchange AI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agentic backend that turns a natural-language film production brief into negotiated, compliance-checked bookings, and can autonomously recover when a booked vendor drops out.

**Architecture:** Seven Docker containers from one shared image. An orchestrator drives two explicit sequences (a 10-step happy path, a 7-step recovery) by calling five FastMCP agent services over streamable HTTP. Agents call three REST vendor-mock services that hold hidden reservation prices in-process. Postgres is the system of record with strict per-agent table ownership; ClickHouse is an async write-through read by the negotiation anchor.

**Tech Stack:** Python 3.11, FastAPI, FastMCP, SQLAlchemy 2.0 async + asyncpg, PostgreSQL 16, ClickHouse, Google Gemini (`google-genai`), pytest + pytest-asyncio, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-19-cinexchange-backend-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Python 3.11+. All I/O paths are `async`. No blocking calls in request handlers.
- One Docker image, seven entrypoints selected by the `SERVICE` env var.
- **Strict table ownership.** A service writes only the tables listed for it in spec §4. Every service may append to `audit_log`; no service may ever update or delete an `audit_log` row.
- **Every agent decision writes to `audit_log`.** No exceptions. A decision that is not audited is a bug.
- **Live LLM only.** No stub or fallback LLM implementation ships. Tests inject fakes via pytest fixture dependency override only.
- `NEGOTIATION_MAX_ROUNDS` is env-configurable, value `3` in `.env.demo`. Never hardcode `3` in logic.
- `APPROVAL_THRESHOLD_PCT` default `10`. Threshold logic lives in one pure function, never in a prompt.
- No Alembic. Schema comes from SQLAlchemy `create_all()` plus an idempotent seed script.
- A vendor's reservation price never leaves the vendor process — not in a response body, not in a log line.
- Money is `Decimal` in Python and `NUMERIC(12,2)` in Postgres. Never `float` for money.
- All timestamps are timezone-aware UTC.
- Every service exposes `GET /healthz`.

## File Structure

| Path | Responsibility |
|---|---|
| `pyproject.toml` | uv-managed deps, pytest config |
| `Dockerfile` | one image; `entrypoint.sh` dispatches on `SERVICE` |
| `docker-compose.yml` | 7 app containers + postgres + clickhouse |
| `.env.example` / `.env.demo` | config template; frozen demo values |
| `cinex/config.py` | `Settings` (pydantic-settings), `get_settings()` |
| `cinex/logging.py` | JSON formatter, `get_logger(name)` |
| `cinex/db/models.py` | all 9 ORM models + indexes |
| `cinex/db/session.py` | async engine, `session_scope()`, `init_db()` |
| `cinex/audit.py` | `write_audit(...)` — the only writer to `audit_log` |
| `cinex/steps.py` | `emit_step(...)` / `read_steps(...)` — step projection over `audit_log` |
| `cinex/auth.py` | stub JWT issue/verify + `require_producer` dependency |
| `cinex/http.py` | `request_with_retry(...)`, `VendorUnavailable` |
| `cinex/mcp_client.py` | `AgentClients.call(agent, tool, args)` |
| `cinex/llm/gemini.py` | `GeminiClient.generate_json(prompt, schema)` |
| `cinex/llm/prompts/` | prompt templates, one file per agent |
| `cinex/schemas/` | pydantic models crossing service boundaries |
| `services/vendor_mock/policy.py` | pure concession logic — no I/O, no DB |
| `services/vendor_mock/main.py` | quote / negotiate / availability / disable |
| `services/producer_agent/main.py` | `decompose_brief` MCP tool |
| `services/scout_agent/main.py` | `find_vendors` MCP tool + ranking |
| `services/negotiation_agent/main.py` | `negotiate` MCP tool + round loop |
| `services/compliance_agent/rules.py` | pure rules + `evaluate_approval` |
| `services/compliance_agent/main.py` | `check_compliance`, `request_approval` |
| `services/recovery_agent/main.py` | `recover` MCP tool, 7-step machine |
| `services/orchestrator/pipeline.py` | the 10-step sequence |
| `services/orchestrator/main.py` | REST + SSE surface |
| `seeds/vendors.json`, `seeds/seed.py` | ~15 vendors across 3 endpoints |
| `tests/` | unit, service, integration |

---

## Task 1: Project skeleton, config, and dependency verification

**Files:**
- Create: `pyproject.toml`, `Dockerfile`, `entrypoint.sh`, `.env.example`, `.env.demo`, `.gitignore`
- Create: `cinex/__init__.py`, `cinex/config.py`, `cinex/logging.py`
- Test: `tests/test_config.py`, `tests/test_dependency_apis.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `cinex.config.Settings`, `cinex.config.get_settings() -> Settings`, `cinex.logging.get_logger(name: str) -> logging.Logger`.

- [ ] **Step 1: Initialise the uv project and pin dependencies**

```bash
cd /d/CineXchange
uv init --no-workspace --python 3.11 .
uv add fastapi "uvicorn[standard]" fastmcp google-genai \
       "sqlalchemy[asyncio]" asyncpg pydantic pydantic-settings \
       python-jose httpx clickhouse-connect
uv add --dev pytest pytest-asyncio anyio
```

- [ ] **Step 2: Verify the two SDK APIs this plan depends on**

Both `fastmcp` and `google-genai` move fast. Confirm the real surface before any code is written against it. Write `tests/test_dependency_apis.py`:

```python
"""Pins the third-party API surface this codebase depends on.

If these fail after a dependency bump, the wrapper modules
(cinex/mcp_client.py, cinex/llm/gemini.py) need updating - not these tests.
"""
import inspect


def test_fastmcp_server_surface():
    from fastmcp import FastMCP
    server = FastMCP("probe")
    assert hasattr(server, "tool"), "decorator used by every agent service"
    assert hasattr(server, "http_app"), "used to mount MCP under FastAPI"


def test_fastmcp_client_surface():
    from fastmcp import Client
    assert hasattr(Client, "call_tool")
    assert hasattr(Client, "list_tools")


def test_google_genai_async_surface():
    from google import genai
    client = genai.Client(api_key="probe-key-not-used")
    assert hasattr(client, "aio"), "async namespace required - no blocking LLM calls"
    sig = inspect.signature(client.aio.models.generate_content)
    assert "config" in sig.parameters, "response_schema is passed via config"
```

- [ ] **Step 3: Run the verification tests**

Run: `uv run pytest tests/test_dependency_apis.py -v`
Expected: PASS. If any fail, record the real API shape in a comment at the top of the file and adjust Tasks 8 and 11 to match before continuing.

- [ ] **Step 4: Pin the Gemini model id from the live API**

Do not hardcode a model id from memory. Run:

```bash
GEMINI_API_KEY=<your key> uv run python -c "
from google import genai, os
c = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
for m in c.models.list():
    if 'generateContent' in getattr(m, 'supported_actions', []) or True:
        print(m.name)
"
```

Pick the current fast general-purpose model. Write that exact id into `.env.example` and `.env.demo` as `GEMINI_MODEL`.

- [ ] **Step 5: Write the failing config test**

```python
# tests/test_config.py
import pytest
from cinex.config import Settings


def _base(**over):
    defaults = dict(
        database_url="postgresql+asyncpg://u:p@localhost/db",
        gemini_api_key="k",
        gemini_model="m",
        jwt_secret="s",
    )
    return Settings(**(defaults | over))


def test_demo_defaults():
    s = _base()
    assert s.negotiation_max_rounds == 3
    assert s.approval_threshold_pct == 10.0
    assert s.vendor_timeout_s == 5.0
    assert s.insurance_rider_threshold == 50000


def test_agent_urls_are_configurable():
    s = _base(scout_agent_url="http://scout:8002/mcp")
    assert s.agent_urls()["scout"] == "http://scout:8002/mcp"
    assert set(s.agent_urls()) == {"producer", "scout", "negotiation", "compliance", "recovery"}


def test_missing_required_key_is_an_error():
    with pytest.raises(Exception):
        Settings(database_url="x", gemini_model="m", jwt_secret="s")
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.config'`

- [ ] **Step 7: Implement config**

```python
# cinex/config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service: str = "orchestrator"

    database_url: str
    clickhouse_url: str = "http://clickhouse:8123"
    jwt_secret: str
    demo_producer_id: str = "11111111-1111-1111-1111-111111111111"

    gemini_api_key: str
    gemini_model: str

    approval_threshold_pct: float = 10.0
    negotiation_max_rounds: int = 3
    vendor_timeout_s: float = 5.0
    llm_timeout_s: float = 30.0
    insurance_rider_threshold: float = 50000

    producer_agent_url: str = "http://producer-agent:8001/mcp"
    scout_agent_url: str = "http://scout-agent:8002/mcp"
    negotiation_agent_url: str = "http://negotiation-agent:8003/mcp"
    compliance_agent_url: str = "http://compliance-agent:8004/mcp"
    recovery_agent_url: str = "http://recovery-agent:8005/mcp"

    def agent_urls(self) -> dict[str, str]:
        return {
            "producer": self.producer_agent_url,
            "scout": self.scout_agent_url,
            "negotiation": self.negotiation_agent_url,
            "compliance": self.compliance_agent_url,
            "recovery": self.recovery_agent_url,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 8: Implement JSON logging**

```python
# cinex/logging.py
import json
import logging
import sys
from datetime import datetime, timezone

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        payload.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED})
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger
```

- [ ] **Step 9: Run the config tests**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 10: Write the image, entrypoint, and env files**

`entrypoint.sh`:

```bash
#!/usr/bin/env sh
set -e
case "$SERVICE" in
  orchestrator)       exec uvicorn services.orchestrator.main:app       --host 0.0.0.0 --port 8000 ;;
  producer-agent)     exec uvicorn services.producer_agent.main:app     --host 0.0.0.0 --port 8001 ;;
  scout-agent)        exec uvicorn services.scout_agent.main:app        --host 0.0.0.0 --port 8002 ;;
  negotiation-agent)  exec uvicorn services.negotiation_agent.main:app  --host 0.0.0.0 --port 8003 ;;
  compliance-agent)   exec uvicorn services.compliance_agent.main:app   --host 0.0.0.0 --port 8004 ;;
  recovery-agent)     exec uvicorn services.recovery_agent.main:app     --host 0.0.0.0 --port 8005 ;;
  vendor-mock)        exec uvicorn services.vendor_mock.main:app        --host 0.0.0.0 --port "${PORT:-9001}" ;;
  *) echo "unknown SERVICE: $SERVICE" >&2; exit 1 ;;
esac
```

`Dockerfile`:

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY cinex ./cinex
COPY services ./services
COPY seeds ./seeds
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["./entrypoint.sh"]
```

`.env.example` — every key from the Settings model, with `GEMINI_MODEL` set to the id pinned in Step 4 and `GEMINI_API_KEY` left blank.

`.env.demo` — same, plus the frozen demo values:

```
NEGOTIATION_MAX_ROUNDS=3
APPROVAL_THRESHOLD_PCT=10
VENDOR_TIMEOUT_S=5
```

`.gitignore`:

```
.env
.venv/
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 11: Add pytest config to `pyproject.toml`**

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = [
    "integration: requires docker compose to be running",
]
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: project skeleton, config, structured logging, dependency API pins"
```

---

## Task 2: Database models and session

**Files:**
- Create: `cinex/db/__init__.py`, `cinex/db/models.py`, `cinex/db/session.py`
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `Base`, and models `Production`, `Requirement`, `Vendor`, `Offer`, `Booking`, `ComplianceCheck`, `Approval`, `RecoveryEvent`, `AuditLog`. Session helpers `session_scope()` (async context manager yielding `AsyncSession`) and `init_db()`.

- [ ] **Step 1: Write the failing model test**

```python
# tests/test_models.py
import uuid
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinex.db.models import Base, Offer, Production, Requirement, Vendor

pytestmark = pytest.mark.integration

DSN = "postgresql+asyncpg://cinex:cinex@localhost:5432/cinex_test"


@pytest.fixture
async def session():
    engine = create_async_engine(DSN)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_production_defaults_and_money_precision(session):
    p = Production(
        producer_id=uuid.uuid4(),
        brief_text="a 3-day shoot in Lisbon",
        budget_cap=Decimal("120000.00"),
        location="Lisbon",
        start_date="2026-09-01",
        end_date="2026-09-03",
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    assert p.status == "draft"
    assert p.current_step == 0
    assert p.created_at is not None and p.created_at.tzinfo is not None
    assert p.budget_cap == Decimal("120000.00")


async def test_offer_belongs_to_requirement_and_vendor(session):
    p = Production(
        producer_id=uuid.uuid4(), brief_text="b", budget_cap=Decimal("1000.00"),
        location="Lisbon", start_date="2026-09-01", end_date="2026-09-03",
    )
    session.add(p)
    await session.flush()
    r = Requirement(production_id=p.id, category="camera", spec={"model": "Alexa"}, quantity=2, priority=1)
    v = Vendor(
        name="Lisbon Camera Co", category="camera", rating=Decimal("4.5"),
        base_price=Decimal("2000.00"), availability_calendar={"blocked": []},
        contact_meta={"endpoint": "http://vendor-mock-1:9001"},
    )
    session.add_all([r, v])
    await session.flush()
    o = Offer(requirement_id=r.id, vendor_id=v.id, price=Decimal("1900.00"), terms={}, status="pending", round=0)
    session.add(o)
    await session.commit()
    await session.refresh(o)
    assert o.status == "pending"
    assert o.is_winner is False
```

- [ ] **Step 2: Start Postgres and run the test to confirm it fails**

```bash
docker run -d --name cinex-pg -e POSTGRES_USER=cinex -e POSTGRES_PASSWORD=cinex \
  -e POSTGRES_DB=cinex_test -p 5432:5432 postgres:16
uv run pytest tests/test_models.py -v
```

Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.db.models'`

- [ ] **Step 3: Implement the models**

```python
# cinex/db/models.py
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(12, 2)


class Base(DeclarativeBase):
    pass


class TimestampedUUID:
    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Production(TimestampedUUID, Base):
    __tablename__ = "productions"
    producer_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    brief_text: Mapped[str] = mapped_column(Text, nullable=False)
    budget_cap: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)


class Requirement(TimestampedUUID, Base):
    __tablename__ = "requirements"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    spec: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class Vendor(TimestampedUUID, Base):
    __tablename__ = "vendors"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False, default=Decimal("4.0"))
    base_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    availability_calendar: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    contact_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Offer(TimestampedUUID, Base):
    __tablename__ = "offers"
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("requirements.id"), nullable=False)
    vendor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vendors.id"), nullable=False)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    terms: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_winner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (Index("ix_offers_requirement_status", "requirement_id", "status"),)


class Booking(TimestampedUUID, Base):
    __tablename__ = "bookings"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offers.id"), nullable=False)
    final_price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="confirmed")
    booked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_bookings_production_status", "production_id", "status"),)


class ComplianceCheck(TimestampedUUID, Base):
    __tablename__ = "compliance_checks"
    production_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("productions.id"), nullable=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    check_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    evidence: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class Approval(TimestampedUUID, Base):
    __tablename__ = "approvals"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    requested_by_agent: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    threshold_breached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delta_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    producer_decision: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RecoveryEvent(TimestampedUUID, Base):
    __tablename__ = "recovery_events"
    production_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("productions.id"), nullable=False)
    trigger: Mapped[str] = mapped_column(String(64), nullable=False)
    affected_booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    resolution_booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    __table_args__ = (
        Index(
            "uq_recovery_active_per_production",
            "production_id",
            unique=True,
            postgresql_where=text("status IN ('pending','in_progress','awaiting_approval')"),
        ),
    )


class AuditLog(TimestampedUUID, Base):
    __tablename__ = "audit_log"
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_created", "created_at"),
    )
```

Note: `audit_log.timestamp` from the spec is served by the inherited `created_at` column. Keeping one timestamp column avoids two sources of truth for ordering.

- [ ] **Step 4: Implement the session helpers**

```python
# cinex/db/session.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from cinex.config import get_settings
from cinex.db.models import Base


@lru_cache
def get_engine() -> AsyncEngine:
    return create_async_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_models.py -v -m integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cinex/db tests/test_models.py
git commit -m "feat: postgres models with strict money precision and recovery idempotency index"
```

---

## Task 3: Audit log and step projection

`audit_log` is the artifact that proves the system is not scripted, and it doubles as the step
projection that `/status` and SSE both read — which is what makes them structurally unable to
disagree.

**Files:**
- Create: `cinex/audit.py`, `cinex/steps.py`
- Test: `tests/test_audit.py`

**Interfaces:**
- Consumes: `cinex.db.models.AuditLog`, `session_scope`.
- Produces:
  - `write_audit(session, *, actor, action, entity_type, entity_id, payload) -> AuditLog`
  - `emit_step(session, production_id, step, name, status, detail=None) -> AuditLog`
  - `read_steps(session, production_id, after=None) -> list[StepEvent]`
  - `StepEvent` dataclass with fields `production_id, step, name, status, detail, ts`
  - `STEP_ACTION_PREFIX = "step."`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_audit.py
import uuid
from decimal import Decimal

import pytest

from cinex.audit import write_audit
from cinex.steps import emit_step, read_steps

pytestmark = pytest.mark.integration


async def test_write_audit_persists_actor_and_payload(session):
    entity = uuid.uuid4()
    row = await write_audit(
        session, actor="negotiation-agent", action="round.counter",
        entity_type="offer", entity_id=entity, payload={"price": Decimal("1900.00")},
    )
    await session.commit()
    assert row.actor == "negotiation-agent"
    assert row.payload["price"] == "1900.00", "Decimal must survive as an exact string, not a float"


async def test_steps_are_readable_in_order(session, production):
    await emit_step(session, production.id, 2, "decompose", "in_progress")
    await emit_step(session, production.id, 2, "decompose", "done", {"requirements": 6})
    await session.commit()

    steps = await read_steps(session, production.id)
    assert [(s.step, s.status) for s in steps] == [(2, "in_progress"), (2, "done")]
    assert steps[-1].detail == {"requirements": 6}


async def test_read_steps_after_cursor_returns_only_newer(session, production):
    await emit_step(session, production.id, 1, "ingest", "done")
    await session.commit()
    first = (await read_steps(session, production.id))[-1]

    await emit_step(session, production.id, 2, "decompose", "done")
    await session.commit()

    later = await read_steps(session, production.id, after=first.ts)
    assert [s.step for s in later] == [2]
```

Add shared fixtures in `tests/conftest.py`:

```python
# tests/conftest.py
import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinex.db.models import Base, Production

DSN = "postgresql+asyncpg://cinex:cinex@localhost:5432/cinex_test"


@pytest.fixture
async def session():
    engine = create_async_engine(DSN)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
async def production(session):
    p = Production(
        producer_id=uuid.uuid4(),
        brief_text="3-day commercial shoot in Lisbon, two camera crews, drone work",
        budget_cap=Decimal("120000.00"),
        location="Lisbon",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 3),
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest tests/test_audit.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.audit'`

- [ ] **Step 3: Implement the audit writer**

```python
# cinex/audit.py
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from cinex.db.models import AuditLog
from cinex.logging import get_logger

log = get_logger("cinex.audit")


def jsonable(value: Any) -> Any:
    """Decimals become exact strings. A float would silently lose cents."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


async def write_audit(
    session: AsyncSession,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    payload: dict | None = None,
) -> AuditLog:
    row = AuditLog(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=jsonable(payload or {}),
    )
    session.add(row)
    await session.flush()
    log.info("audit", extra={"actor": actor, "action": action, "entity_id": str(entity_id)})
    return row
```

- [ ] **Step 4: Implement the step projection**

```python
# cinex/steps.py
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinex.audit import write_audit
from cinex.db.models import AuditLog

STEP_ACTION_PREFIX = "step."
ORCHESTRATOR = "orchestrator"


@dataclass(frozen=True)
class StepEvent:
    production_id: uuid.UUID
    step: int
    name: str
    status: str          # in_progress | done | failed
    detail: dict
    ts: datetime

    def sse(self) -> str:
        import json
        body = {
            "production_id": str(self.production_id),
            "step": self.step,
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "ts": self.ts.isoformat(),
        }
        return f"event: step\ndata: {json.dumps(body)}\n\n"


async def emit_step(
    session: AsyncSession,
    production_id: uuid.UUID,
    step: int,
    name: str,
    status: str,
    detail: dict | None = None,
) -> AuditLog:
    return await write_audit(
        session,
        actor=ORCHESTRATOR,
        action=f"{STEP_ACTION_PREFIX}{name}.{status}",
        entity_type="production",
        entity_id=production_id,
        payload={"step": step, "name": name, "status": status, "detail": detail or {}},
    )


async def read_steps(
    session: AsyncSession, production_id: uuid.UUID, after: datetime | None = None
) -> list[StepEvent]:
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == "production",
            AuditLog.entity_id == production_id,
            AuditLog.action.startswith(STEP_ACTION_PREFIX),
        )
        .order_by(AuditLog.created_at, AuditLog.id)
    )
    if after is not None:
        stmt = stmt.where(AuditLog.created_at > after)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        StepEvent(
            production_id=production_id,
            step=r.payload["step"],
            name=r.payload["name"],
            status=r.payload["status"],
            detail=r.payload.get("detail", {}),
            ts=r.created_at,
        )
        for r in rows
    ]
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_audit.py -v -m integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cinex/audit.py cinex/steps.py tests/test_audit.py tests/conftest.py
git commit -m "feat: audit log writer and DB-backed step projection shared by SSE and status"
```

---

## Task 4: Stub JWT auth

Structured so real IAM swaps in by replacing `verify_token` alone — no business logic references
the token format.

**Files:**
- Create: `cinex/auth.py`
- Test: `tests/test_auth.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `issue_demo_token() -> str`, `verify_token(token: str) -> Producer`, `require_producer` (FastAPI dependency returning `Producer`), `Producer` dataclass with field `id: uuid.UUID`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_auth.py
import uuid

import pytest
from fastapi import HTTPException

from cinex.auth import Producer, issue_demo_token, verify_token


def test_round_trip():
    token = issue_demo_token()
    producer = verify_token(token)
    assert isinstance(producer, Producer)
    assert isinstance(producer.id, uuid.UUID)


def test_tampered_token_rejected():
    token = issue_demo_token()
    with pytest.raises(HTTPException) as exc:
        verify_token(token[:-3] + "abc")
    assert exc.value.status_code == 401


def test_garbage_token_rejected():
    with pytest.raises(HTTPException):
        verify_token("not-a-jwt")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest tests/test_auth.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.auth'`

- [ ] **Step 3: Implement**

```python
# cinex/auth.py
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from cinex.config import get_settings

ALGORITHM = "HS256"
_bearer = HTTPBearer(auto_error=True)


@dataclass(frozen=True)
class Producer:
    id: uuid.UUID


def issue_demo_token() -> str:
    settings = get_settings()
    claims = {
        "sub": settings.demo_producer_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
        "iss": "cinexchange-demo",
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def verify_token(token: str) -> Producer:
    """The single seam real IAM replaces. Nothing downstream knows about JWTs."""
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
        return Producer(id=uuid.UUID(claims["sub"]))
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid or expired token") from exc


def require_producer(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Producer:
    return verify_token(creds.credentials)
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_auth.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cinex/auth.py tests/test_auth.py
git commit -m "feat: stub JWT auth with a single swap seam for real IAM"
```

---

## Task 5: Vendor concession policy (pure logic)

The most important unit in the build. It is pure, has no I/O, and carries the invariant the whole
"prove it isn't fake" claim rests on: **a vendor never counters below its own reservation price.**

**Files:**
- Create: `services/__init__.py`, `services/vendor_mock/__init__.py`, `services/vendor_mock/policy.py`
- Test: `tests/test_vendor_policy.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `VendorPolicy` (frozen dataclass: `floor_pct, concession_rate, bundle_appetite, patience`), `derive_policy(vendor_id: uuid.UUID) -> VendorPolicy`, `VendorDecision` (frozen dataclass: `decision, price, terms, message`), `respond(policy, base_price, current_ask, offer_price, offer_terms, round_no) -> VendorDecision`, `opening_ask(base_price) -> Decimal`, `LIST_MULTIPLIER`, `CONCEDABLE_TERMS`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_vendor_policy.py
import uuid
from decimal import Decimal

from services.vendor_mock.policy import (
    CONCEDABLE_TERMS, derive_policy, opening_ask, respond,
)

BASE = Decimal("2000.00")


def test_policy_is_deterministic_for_a_vendor_id():
    vid = uuid.UUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
    assert derive_policy(vid) == derive_policy(vid)


def test_policy_differs_across_vendors():
    a = derive_policy(uuid.UUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301"))
    b = derive_policy(uuid.UUID("aaaaaaaa-4f89-11d3-9a0c-0305e82c3301"))
    assert a != b


def test_accepts_offer_at_or_above_reservation():
    policy = derive_policy(uuid.uuid4())
    reservation = BASE * Decimal(str(policy.floor_pct))
    decision = respond(policy, BASE, opening_ask(BASE), reservation, {}, 1)
    assert decision.decision == "accept"


def test_never_counters_below_reservation_across_many_seeds_and_rounds():
    """The invariant the demo's credibility depends on."""
    for i in range(200):
        vid = uuid.UUID(int=i, version=4)
        policy = derive_policy(vid)
        reservation = BASE * Decimal(str(policy.floor_pct))
        ask = opening_ask(BASE)
        lowball = BASE * Decimal("0.10")
        for round_no in range(1, 11):
            decision = respond(policy, BASE, ask, lowball, {}, round_no)
            if decision.decision == "counter":
                assert decision.price >= reservation, (
                    f"vendor {vid} crossed its floor at round {round_no}"
                )
                ask = decision.price
            else:
                break


def test_holds_firm_and_rejects_once_patience_is_exhausted():
    policy = derive_policy(uuid.uuid4())
    lowball = BASE * Decimal("0.10")
    decision = respond(policy, BASE, opening_ask(BASE), lowball, {}, policy.patience + 1)
    assert decision.decision == "reject"


def test_conceded_terms_lower_the_effective_reservation_for_receptive_vendors():
    """Find a vendor with appetite, then show a term concession buys a lower price."""
    policy = next(
        derive_policy(uuid.UUID(int=i, version=4))
        for i in range(500)
        if derive_policy(uuid.UUID(int=i, version=4)).bundle_appetite > 0.5
    )
    reservation = BASE * Decimal(str(policy.floor_pct))
    just_under = reservation * Decimal("0.97")

    without = respond(policy, BASE, opening_ask(BASE), just_under, {}, 1)
    with_bundle = respond(
        policy, BASE, opening_ask(BASE), just_under, {next(iter(CONCEDABLE_TERMS)): True}, 1
    )
    assert without.decision == "counter"
    assert with_bundle.decision == "accept"


def test_response_never_leaks_the_reservation_price():
    policy = derive_policy(uuid.uuid4())
    decision = respond(policy, BASE, opening_ask(BASE), BASE * Decimal("0.10"), {}, 1)
    serialised = f"{decision.terms}{decision.message}".lower()
    assert "reservation" not in serialised and "floor" not in serialised
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_vendor_policy.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.vendor_mock.policy'`

- [ ] **Step 3: Implement**

```python
# services/vendor_mock/policy.py
"""Vendor-side negotiation logic.

Everything here stays inside the vendor process. The reservation price is never
serialised into a response, a log line, or an audit payload - the negotiating
agent runs in a different container and provably cannot read it.
"""
import random
import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

LIST_MULTIPLIER = Decimal("1.15")
MAX_BUNDLE_DISCOUNT = Decimal("0.05")
CONCEDABLE_TERMS = frozenset({"flexible_dates", "extended_rental_days", "bundled_units"})
CENTS = Decimal("0.01")


@dataclass(frozen=True)
class VendorPolicy:
    floor_pct: float
    concession_rate: float
    bundle_appetite: float
    patience: int


@dataclass(frozen=True)
class VendorDecision:
    decision: str          # accept | counter | reject
    price: Decimal
    terms: dict
    message: str


def derive_policy(vendor_id: uuid.UUID) -> VendorPolicy:
    rng = random.Random(int(vendor_id.hex[:8], 16))
    return VendorPolicy(
        floor_pct=rng.uniform(0.72, 0.88),
        concession_rate=rng.uniform(0.25, 0.55),
        bundle_appetite=rng.uniform(0.0, 1.0),
        patience=rng.randint(2, 4),
    )


def opening_ask(base_price: Decimal) -> Decimal:
    return _money(base_price * LIST_MULTIPLIER)


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _reservation(policy: VendorPolicy, base_price: Decimal, offer_terms: dict) -> Decimal:
    reservation = base_price * Decimal(str(policy.floor_pct))
    conceded = [t for t in CONCEDABLE_TERMS if offer_terms.get(t)]
    if conceded and policy.bundle_appetite > 0.5:
        discount = min(MAX_BUNDLE_DISCOUNT, MAX_BUNDLE_DISCOUNT * Decimal(str(policy.bundle_appetite)))
        reservation *= Decimal("1") - discount
    return reservation


def respond(
    policy: VendorPolicy,
    base_price: Decimal,
    current_ask: Decimal,
    offer_price: Decimal,
    offer_terms: dict,
    round_no: int,
) -> VendorDecision:
    reservation = _reservation(policy, base_price, offer_terms)

    if offer_price >= reservation:
        return VendorDecision("accept", _money(offer_price), dict(offer_terms), "Agreed. Booking confirmed.")

    if round_no > policy.patience:
        return VendorDecision(
            "reject", _money(current_ask), {}, "We can't go lower on this one. Withdrawing."
        )

    target = max(reservation, offer_price)
    new_ask = current_ask - Decimal(str(policy.concession_rate)) * (current_ask - target)
    return VendorDecision(
        "counter",
        _money(new_ask),
        {"valid_rounds": 1},
        "That's below what we can do, but here's an improved number.",
    )
```

Why the invariant holds: `new_ask = ask*(1-rate) + rate*target` with `rate < 1`, so `new_ask` lies
between `ask` and `target`. `target >= reservation` by construction and `ask >= reservation` by
induction from `opening_ask = base * 1.15 > base * 0.88 >= reservation`. The counter therefore can
never dip below the floor.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_vendor_policy.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add services/vendor_mock/policy.py tests/test_vendor_policy.py
git commit -m "feat: deterministic vendor concession policy that never crosses its reservation"
```

---

## Task 6: Vendor mock service

**Files:**
- Create: `services/vendor_mock/main.py`
- Test: `tests/test_vendor_service.py`

**Interfaces:**
- Consumes: `services.vendor_mock.policy` (all of it).
- Produces: FastAPI `app` with `GET /vendors/{vendor_id}/quote`, `POST /vendors/{vendor_id}/negotiate`, `POST /vendors/{vendor_id}/availability`, `POST /admin/vendors/{vendor_id}/disable`, `GET /healthz`.

Vendor identity is derived entirely from the `vendor_id` in the path plus the `base_price` the
caller passes. The vendor service holds no database — session state only. This keeps it a genuine
external counterparty rather than a view over our own tables.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vendor_service.py
import uuid

import httpx
import pytest

from services.vendor_mock.main import app, _sessions
from services.vendor_mock.policy import derive_policy


@pytest.fixture(autouse=True)
def clear_sessions():
    _sessions.clear()
    yield
    _sessions.clear()


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://vendor") as c:
        yield c


VID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"


async def test_quote_returns_list_price_above_base(client):
    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 2, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-03",
    })
    assert r.status_code == 200
    body = r.json()
    assert float(body["price"]) > 2000.0
    assert body["available"] is True


async def test_negotiation_state_advances_across_rounds(client):
    session_id = str(uuid.uuid4())
    prices = []
    for round_no in (1, 2):
        r = await client.post(f"/vendors/{VID}/negotiate", json={
            "session_id": session_id, "round": round_no,
            "price": "500.00", "terms": {}, "base_price": "2000.00",
        })
        body = r.json()
        if body["decision"] != "counter":
            break
        prices.append(float(body["price"]))
    assert len(prices) == 2, "expected two counters"
    assert prices[1] < prices[0], "vendor must actually concede between rounds"


async def test_disabled_vendor_stops_quoting(client):
    await client.post(f"/admin/vendors/{VID}/disable")
    r = await client.get(f"/vendors/{VID}/quote", params={
        "category": "camera", "quantity": 1, "base_price": "2000.00",
        "start": "2026-09-01", "end": "2026-09-03",
    })
    assert r.status_code == 503


async def test_response_body_never_contains_the_floor(client):
    policy = derive_policy(uuid.UUID(VID))
    reservation = 2000.0 * policy.floor_pct
    r = await client.post(f"/vendors/{VID}/negotiate", json={
        "session_id": str(uuid.uuid4()), "round": 1,
        "price": "100.00", "terms": {}, "base_price": "2000.00",
    })
    assert f"{reservation:.2f}" not in r.text


async def test_healthz(client):
    assert (await client.get("/healthz")).status_code == 200
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_vendor_service.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.vendor_mock.main'`

- [ ] **Step 3: Implement**

```python
# services/vendor_mock/main.py
"""A mock vendor marketplace. Several vendor personas live behind one process;
identity comes from the vendor_id in the path. No database - this is an
external counterparty, not a view over our own tables.
"""
import uuid
from datetime import date
from decimal import Decimal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from cinex.logging import get_logger
from services.vendor_mock.policy import derive_policy, opening_ask, respond

log = get_logger("vendor-mock")
app = FastAPI(title="CineXchange Vendor Mock")

# session_id -> {"ask": Decimal, "rounds": int}
_sessions: dict[str, dict] = {}
_disabled: set[str] = set()


class NegotiateRequest(BaseModel):
    session_id: str
    round: int = Field(ge=1)
    price: Decimal
    terms: dict = Field(default_factory=dict)
    base_price: Decimal


class AvailabilityRequest(BaseModel):
    start: date
    end: date
    blocked: list[str] = Field(default_factory=list)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "disabled_vendors": len(_disabled)}


@app.get("/vendors/{vendor_id}/quote")
async def quote(
    vendor_id: uuid.UUID,
    category: str,
    quantity: int,
    base_price: Decimal,
    start: date,
    end: date,
) -> dict:
    if str(vendor_id) in _disabled:
        raise HTTPException(status_code=503, detail="vendor unavailable")
    days = max((end - start).days, 1)
    ask = opening_ask(base_price) * quantity * days
    return {
        "price": str(ask.quantize(Decimal("0.01"))),
        "terms": {
            "category": category,
            "quantity": quantity,
            "days": days,
            "cancellation": "48h",
        },
        "available": True,
    }


@app.post("/vendors/{vendor_id}/negotiate")
async def negotiate(vendor_id: uuid.UUID, req: NegotiateRequest) -> dict:
    if str(vendor_id) in _disabled:
        raise HTTPException(status_code=503, detail="vendor unavailable")

    policy = derive_policy(vendor_id)
    state = _sessions.setdefault(
        req.session_id, {"ask": opening_ask(req.base_price), "rounds": 0}
    )
    state["rounds"] = req.round

    decision = respond(
        policy=policy,
        base_price=req.base_price,
        current_ask=state["ask"],
        offer_price=req.price,
        offer_terms=req.terms,
        round_no=req.round,
    )
    if decision.decision == "counter":
        state["ask"] = decision.price

    log.info(
        "negotiate",
        extra={
            "vendor_id": str(vendor_id),
            "round": req.round,
            "offered": str(req.price),
            "decision": decision.decision,
        },
    )
    return {
        "decision": decision.decision,
        "price": str(decision.price),
        "terms": decision.terms,
        "message": decision.message,
    }


@app.post("/vendors/{vendor_id}/availability")
async def availability(vendor_id: uuid.UUID, req: AvailabilityRequest) -> dict:
    if str(vendor_id) in _disabled:
        raise HTTPException(status_code=503, detail="vendor unavailable")
    wanted = {
        (req.start.toordinal() + offset)
        for offset in range((req.end - req.start).days + 1)
    }
    blocked = {date.fromisoformat(d).toordinal() for d in req.blocked}
    conflicts = sorted(date.fromordinal(o).isoformat() for o in wanted & blocked)
    return {"available": not conflicts, "conflicts": conflicts}


@app.post("/admin/vendors/{vendor_id}/disable")
async def disable(vendor_id: uuid.UUID) -> dict:
    """Demo trigger. Makes the vendor genuinely go dark so recovery reacts to a
    real 503 rather than to a flag we set for it."""
    _disabled.add(str(vendor_id))
    log.info("vendor_disabled", extra={"vendor_id": str(vendor_id)})
    return {"vendor_id": str(vendor_id), "disabled": True}


@app.post("/admin/vendors/{vendor_id}/enable")
async def enable(vendor_id: uuid.UUID) -> dict:
    _disabled.discard(str(vendor_id))
    return {"vendor_id": str(vendor_id), "disabled": False}
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_vendor_service.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/vendor_mock/main.py tests/test_vendor_service.py
git commit -m "feat: vendor mock service with stateful negotiation sessions and a demo kill switch"
```

---

## Task 7: Vendor seed data

**Files:**
- Create: `seeds/vendors.json`, `seeds/seed.py`
- Test: `tests/test_seed.py`

**Interfaces:**
- Consumes: `cinex.db.models.Vendor`, `session_scope`, `init_db`.
- Produces: `seeds.seed.seed_vendors(session) -> int` (returns count inserted), `seeds.seed.load_vendor_records() -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_seed.py
import pytest
from sqlalchemy import select

from cinex.db.models import Vendor
from seeds.seed import load_vendor_records, seed_vendors

pytestmark = pytest.mark.integration

CATEGORIES = {"camera", "crew", "location", "transport", "insurance", "permit"}


def test_seed_file_covers_every_category_with_competition():
    records = load_vendor_records()
    by_category: dict[str, int] = {}
    for r in records:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    assert set(by_category) == CATEGORIES
    assert all(count >= 2 for count in by_category.values()), \
        "every category needs at least two vendors or there is nothing to negotiate between"


def test_seed_file_spreads_across_three_endpoints():
    endpoints = {r["contact_meta"]["endpoint"] for r in load_vendor_records()}
    assert len(endpoints) == 3


async def test_seeding_is_idempotent(session):
    first = await seed_vendors(session)
    await session.commit()
    second = await seed_vendors(session)
    await session.commit()
    total = len((await session.execute(select(Vendor))).scalars().all())
    assert first > 0
    assert second == 0, "re-seeding must not duplicate vendors"
    assert total == first
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_seed.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'seeds.seed'`

- [ ] **Step 3: Write `seeds/vendors.json`**

Fifteen vendors, deterministic UUIDs so the demo script can reference one by id. Two or three per
category, spread across the three endpoints. Follow this shape exactly for all fifteen:

```json
[
  {
    "id": "a0000001-0000-4000-8000-000000000001",
    "name": "Tejo Camera Rentals",
    "category": "camera",
    "rating": 4.7,
    "base_price": "2400.00",
    "availability_calendar": {"blocked": ["2026-09-05", "2026-09-06"]},
    "contact_meta": {"endpoint": "http://vendor-mock-1:9001", "tier": "premium"}
  },
  {
    "id": "a0000001-0000-4000-8000-000000000002",
    "name": "Baixa Broadcast Supply",
    "category": "camera",
    "rating": 4.2,
    "base_price": "2100.00",
    "availability_calendar": {"blocked": []},
    "contact_meta": {"endpoint": "http://vendor-mock-2:9002", "tier": "standard"}
  },
  {
    "id": "a0000001-0000-4000-8000-000000000003",
    "name": "Alfama Optics",
    "category": "camera",
    "rating": 3.9,
    "base_price": "1850.00",
    "availability_calendar": {"blocked": []},
    "contact_meta": {"endpoint": "http://vendor-mock-3:9003", "tier": "budget"}
  }
]
```

Repeat that pattern for `crew` (ids `a0000002-…-0001..0003`), `location` (`a0000003-…`),
`transport` (`a0000004-…`), `insurance` (`a0000005-…0001..0002`), and `permit`
(`a0000006-…0001..0002`). Give at least one `crew` vendor a spec-matching name that reads as
certified work, e.g. "Sintra Aerial Unit (drone)". Vary `base_price` meaningfully within each
category so ranking has something to sort on.

- [ ] **Step 4: Implement the seeder**

```python
# seeds/seed.py
import asyncio
import json
import uuid
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinex.db.models import Vendor
from cinex.db.session import init_db, session_scope
from cinex.logging import get_logger

log = get_logger("seed")
VENDORS_FILE = Path(__file__).parent / "vendors.json"


def load_vendor_records() -> list[dict]:
    return json.loads(VENDORS_FILE.read_text(encoding="utf-8"))


async def seed_vendors(session: AsyncSession) -> int:
    records = load_vendor_records()
    existing = set(
        (await session.execute(select(Vendor.id))).scalars().all()
    )
    inserted = 0
    for record in records:
        vendor_id = uuid.UUID(record["id"])
        if vendor_id in existing:
            continue
        session.add(
            Vendor(
                id=vendor_id,
                name=record["name"],
                category=record["category"],
                rating=Decimal(str(record["rating"])),
                base_price=Decimal(record["base_price"]),
                availability_calendar=record["availability_calendar"],
                contact_meta=record["contact_meta"],
            )
        )
        inserted += 1
    await session.flush()
    return inserted


async def main() -> None:
    await init_db()
    async with session_scope() as session:
        count = await seed_vendors(session)
    log.info("seeded", extra={"inserted": count})


if __name__ == "__main__":
    asyncio.run(main())
```

Add `seeds/__init__.py` (empty) so the package imports.

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_seed.py -v -m integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add seeds tests/test_seed.py
git commit -m "feat: idempotent vendor seed across six categories and three endpoints"
```

---

## Task 8: Resilient vendor HTTP client

Implemented once here and reused by Scout and Negotiation. Do not add retry logic anywhere else.

**Files:**
- Create: `cinex/http.py`
- Test: `tests/test_http.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `VendorUnavailable(Exception)`, `request_with_retry(method: str, url: str, *, json=None, params=None, timeout=None) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_http.py
import httpx
import pytest

from cinex.http import VendorUnavailable, request_with_retry


async def test_returns_json_on_success():
    calls = []

    async def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"price": "10.00"})

    result = await request_with_retry(
        "GET", "http://v/quote", transport=httpx.MockTransport(handler)
    )
    assert result == {"price": "10.00"}
    assert len(calls) == 1


async def test_retries_once_then_succeeds():
    calls = []

    async def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ConnectError("boom", request=request)
        return httpx.Response(200, json={"ok": True})

    result = await request_with_retry(
        "GET", "http://v/quote", transport=httpx.MockTransport(handler)
    )
    assert result == {"ok": True}
    assert len(calls) == 2, "exactly one retry, not more"


async def test_raises_vendor_unavailable_after_the_single_retry():
    calls = []

    async def handler(request):
        calls.append(request)
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(VendorUnavailable):
        await request_with_retry("GET", "http://v/quote", transport=httpx.MockTransport(handler))
    assert len(calls) == 2


async def test_503_is_treated_as_unavailable():
    async def handler(request):
        return httpx.Response(503, json={"detail": "vendor unavailable"})

    with pytest.raises(VendorUnavailable):
        await request_with_retry("GET", "http://v/quote", transport=httpx.MockTransport(handler))
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_http.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.http'`

- [ ] **Step 3: Implement**

```python
# cinex/http.py
"""The one place vendor HTTP resilience lives. Timeout, exactly one retry,
then give up and let the caller decide on a fallback."""
from typing import Any

import httpx

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.http")
ATTEMPTS = 2  # initial call plus one retry


class VendorUnavailable(Exception):
    """The vendor did not answer usefully within the budget."""


async def request_with_retry(
    method: str,
    url: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    timeout: float | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    budget = timeout if timeout is not None else get_settings().vendor_timeout_s
    last: Exception | None = None

    async with httpx.AsyncClient(timeout=budget, transport=transport) as client:
        for attempt in range(1, ATTEMPTS + 1):
            try:
                response = await client.request(method, url, json=json, params=params)
                if response.status_code >= 500:
                    raise VendorUnavailable(f"{url} returned {response.status_code}")
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, VendorUnavailable) as exc:
                last = exc
                log.warning(
                    "vendor_call_failed",
                    extra={"url": url, "attempt": attempt, "error": str(exc)},
                )

    raise VendorUnavailable(f"{method} {url} failed after {ATTEMPTS} attempts: {last}")
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_http.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cinex/http.py tests/test_http.py
git commit -m "feat: vendor HTTP client with a single retry and explicit unavailability signal"
```

---

## Task 9: Gemini client

**Files:**
- Create: `cinex/llm/__init__.py`, `cinex/llm/gemini.py`
- Test: `tests/test_gemini.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `LLMError(Exception)`, `GeminiClient` with `async generate_json(prompt: str, schema: type[T]) -> T` where `T` is a `pydantic.BaseModel` subclass, and `get_llm() -> GeminiClient` (cached).

There is no stub implementation. Tests replace the client object itself.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_gemini.py
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from cinex.llm.gemini import GeminiClient, LLMError


class Shape(BaseModel):
    name: str
    count: int


def _client(monkeypatch, responses):
    client = GeminiClient(api_key="k", model="m", timeout_s=1.0)
    fake = AsyncMock(side_effect=responses)
    monkeypatch.setattr(client, "_raw_generate", fake)
    return client, fake


async def test_parses_valid_json(monkeypatch):
    client, fake = _client(monkeypatch, ['{"name": "camera", "count": 2}'])
    result = await client.generate_json("prompt", Shape)
    assert result == Shape(name="camera", count=2)
    assert fake.await_count == 1


async def test_repairs_once_on_malformed_json(monkeypatch):
    client, fake = _client(monkeypatch, ["not json at all", '{"name": "crew", "count": 5}'])
    result = await client.generate_json("prompt", Shape)
    assert result.count == 5
    assert fake.await_count == 2, "exactly one repair attempt"
    assert "valid JSON" in fake.await_args_list[1].args[0], "repair prompt must state the problem"


async def test_raises_after_the_repair_also_fails(monkeypatch):
    client, _ = _client(monkeypatch, ["garbage", "still garbage"])
    with pytest.raises(LLMError):
        await client.generate_json("prompt", Shape)


async def test_raises_when_schema_does_not_match(monkeypatch):
    client, _ = _client(monkeypatch, ['{"name": "x"}', '{"name": "x"}'])
    with pytest.raises(LLMError):
        await client.generate_json("prompt", Shape)
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_gemini.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.llm.gemini'`

- [ ] **Step 3: Implement**

```python
# cinex/llm/gemini.py
"""Gemini access. Live only - there is deliberately no offline implementation.

If Task 1's dependency probe recorded a different google-genai surface than the
one used in _raw_generate, change _raw_generate and nothing else.
"""
import asyncio
import json
from functools import lru_cache
from typing import TypeVar

from google import genai
from pydantic import BaseModel, ValidationError

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """The model did not return something matching the requested schema."""


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout_s: float) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._timeout_s = timeout_s

    async def _raw_generate(self, prompt: str, schema: type[BaseModel]) -> str:
        response = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "response_schema": schema,
                    "temperature": 0.2,
                },
            ),
            timeout=self._timeout_s,
        )
        return response.text

    async def generate_json(self, prompt: str, schema: type[T]) -> T:
        attempts = [prompt]
        last_error = ""

        for attempt, current in enumerate(attempts, start=1):
            try:
                raw = await self._raw_generate(current, schema)
                return schema.model_validate(json.loads(raw))
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = str(exc)
                log.warning("llm_bad_output", extra={"attempt": attempt, "error": last_error})
                if attempt == 1:
                    attempts.append(
                        f"{prompt}\n\n"
                        f"Your previous reply was not valid JSON matching the required schema. "
                        f"The parser reported: {last_error}\n"
                        f"Reply with valid JSON conforming exactly to the schema, and nothing else."
                    )
            except asyncio.TimeoutError as exc:
                raise LLMError(f"gemini timed out after {self._timeout_s}s") from exc

        raise LLMError(f"gemini returned unusable output twice: {last_error}")


@lru_cache
def get_llm() -> GeminiClient:
    settings = get_settings()
    return GeminiClient(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        timeout_s=settings.llm_timeout_s,
    )
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_gemini.py -v`
Expected: PASS

- [ ] **Step 5: Smoke-test against the real API once**

```bash
uv run python -c "
import asyncio
from pydantic import BaseModel
from cinex.llm.gemini import get_llm

class Ping(BaseModel):
    answer: str

print(asyncio.run(get_llm().generate_json('Reply with answer=pong', Ping)))
"
```

Expected: `answer='pong'`. If this fails, the model id from Task 1 Step 4 is wrong — fix `.env` before continuing.

- [ ] **Step 6: Commit**

```bash
git add cinex/llm tests/test_gemini.py
git commit -m "feat: gemini client with schema-validated output and one repair retry"
```

---

## Task 10: MCP client pool

**Files:**
- Create: `cinex/mcp_client.py`
- Test: `tests/test_mcp_client.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `AgentUnavailable(Exception)`, `AgentClients` with `async call(agent: str, tool: str, args: dict) -> dict` and `async list_tools(agent: str) -> list[str]`, plus `get_agents() -> AgentClients` (cached).

`unwrap_result` handles both FastMCP result shapes so a dependency bump does not break every agent
call site.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_mcp_client.py
import json
from types import SimpleNamespace

import pytest

from cinex.mcp_client import AgentClients, AgentUnavailable, unwrap_result


def test_unwrap_prefers_structured_data():
    result = SimpleNamespace(data={"offers": [1, 2]}, content=[])
    assert unwrap_result(result) == {"offers": [1, 2]}


def test_unwrap_falls_back_to_text_content():
    result = SimpleNamespace(data=None, content=[SimpleNamespace(text=json.dumps({"ok": True}))])
    assert unwrap_result(result) == {"ok": True}


def test_unwrap_raises_on_an_unusable_result():
    with pytest.raises(AgentUnavailable):
        unwrap_result(SimpleNamespace(data=None, content=[]))


async def test_unknown_agent_is_an_error():
    clients = AgentClients({"scout": "http://scout:8002/mcp"})
    with pytest.raises(AgentUnavailable, match="unknown agent"):
        await clients.call("nope", "tool", {})
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_mcp_client.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.mcp_client'`

- [ ] **Step 3: Implement**

```python
# cinex/mcp_client.py
"""Agent-to-agent calls. Every call here is a real network hop to another
container - that is the point, not an accident of deployment."""
import json
from functools import lru_cache
from typing import Any

from fastmcp import Client

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.mcp")


class AgentUnavailable(Exception):
    """An agent could not be reached, or answered with something unusable."""


def unwrap_result(result: Any) -> dict:
    """FastMCP has returned structured output two different ways across versions.
    Accept both so a dependency bump does not break every call site."""
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        return data
    content = getattr(result, "content", None) or []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                raise AgentUnavailable(f"agent returned non-JSON text: {text[:200]}") from exc
    raise AgentUnavailable("agent returned no usable result")


class AgentClients:
    def __init__(self, urls: dict[str, str]) -> None:
        self._urls = urls

    async def call(self, agent: str, tool: str, args: dict) -> dict:
        url = self._urls.get(agent)
        if url is None:
            raise AgentUnavailable(f"unknown agent: {agent}")
        log.info("mcp_call", extra={"agent": agent, "tool": tool})
        try:
            async with Client(url) as client:
                result = await client.call_tool(tool, args)
        except AgentUnavailable:
            raise
        except Exception as exc:
            raise AgentUnavailable(f"{agent}.{tool} failed: {exc}") from exc
        return unwrap_result(result)

    async def list_tools(self, agent: str) -> list[str]:
        url = self._urls.get(agent)
        if url is None:
            raise AgentUnavailable(f"unknown agent: {agent}")
        async with Client(url) as client:
            return [t.name for t in await client.list_tools()]


@lru_cache
def get_agents() -> AgentClients:
    return AgentClients(get_settings().agent_urls())
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_mcp_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cinex/mcp_client.py tests/test_mcp_client.py
git commit -m "feat: MCP client pool tolerant of both FastMCP result shapes"
```

---

## Task 11: Producer Agent

**Files:**
- Create: `cinex/schemas/__init__.py`, `cinex/schemas/agents.py`, `cinex/llm/prompts/producer.py`
- Create: `services/producer_agent/__init__.py`, `services/producer_agent/main.py`
- Test: `tests/test_producer_agent.py`

**Interfaces:**
- Consumes: `get_llm`, `session_scope`, `write_audit`, `Requirement`.
- Produces:
  - `cinex.schemas.agents.CATEGORIES: tuple[str, ...]`
  - `cinex.schemas.agents.RequirementDraft` (fields `category: str`, `spec: dict`, `quantity: int`, `priority: int`)
  - `cinex.schemas.agents.Decomposition` (field `requirements: list[RequirementDraft]`)
  - `services.producer_agent.main.decompose_brief(...)` as an MCP tool, and `app`
  - `services.producer_agent.main.build_mcp_app(mcp)` pattern reused by every later agent

- [ ] **Step 1: Write the failing test**

```python
# tests/test_producer_agent.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Requirement
from cinex.schemas.agents import Decomposition, RequirementDraft

pytestmark = pytest.mark.integration


@pytest.fixture
def fake_llm(monkeypatch):
    from services.producer_agent import main

    result = Decomposition(requirements=[
        RequirementDraft(category="camera", spec={"model": "Alexa Mini"}, quantity=2, priority=1),
        RequirementDraft(category="crew", spec={"role": "drone operator",
                                                "requires_certification": True}, quantity=1, priority=1),
        RequirementDraft(category="permit", spec={"authority": "Lisbon CML"}, quantity=1, priority=2),
    ])
    llm = AsyncMock()
    llm.generate_json = AsyncMock(return_value=result)
    monkeypatch.setattr(main, "get_llm", lambda: llm)
    return llm


async def test_decompose_writes_requirements(session, production, fake_llm):
    from services.producer_agent.main import _decompose

    out = await _decompose(
        production_id=str(production.id), text=production.brief_text,
        budget_cap="120000.00", location="Lisbon",
        start_date="2026-09-01", end_date="2026-09-03",
    )
    assert len(out["requirements"]) == 3

    rows = (await session.execute(
        select(Requirement).where(Requirement.production_id == production.id)
    )).scalars().all()
    assert {r.category for r in rows} == {"camera", "crew", "permit"}


async def test_decompose_audits_the_raw_model_output(session, production, fake_llm):
    from services.producer_agent.main import _decompose

    await _decompose(
        production_id=str(production.id), text=production.brief_text,
        budget_cap="120000.00", location="Lisbon",
        start_date="2026-09-01", end_date="2026-09-03",
    )
    rows = (await session.execute(
        select(AuditLog).where(AuditLog.entity_id == production.id)
    )).scalars().all()
    assert any(r.actor == "producer-agent" and r.action == "decompose_brief" for r in rows)


async def test_rejects_a_category_outside_the_allowed_set(session, production, monkeypatch):
    from services.producer_agent import main
    llm = AsyncMock()
    llm.generate_json = AsyncMock(return_value=Decomposition(requirements=[
        RequirementDraft(category="catering", spec={}, quantity=1, priority=1),
    ]))
    monkeypatch.setattr(main, "get_llm", lambda: llm)

    with pytest.raises(ValueError, match="catering"):
        await main._decompose(
            production_id=str(production.id), text="x", budget_cap="1.00",
            location="Lisbon", start_date="2026-09-01", end_date="2026-09-03",
        )
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_producer_agent.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.schemas.agents'`

- [ ] **Step 3: Write the shared schemas**

```python
# cinex/schemas/agents.py
from pydantic import BaseModel, Field

CATEGORIES = ("camera", "crew", "location", "transport", "insurance", "permit")


class RequirementDraft(BaseModel):
    category: str = Field(description=f"exactly one of: {', '.join(CATEGORIES)}")
    spec: dict = Field(default_factory=dict, description="free-form details: model, role, dates, certifications")
    quantity: int = Field(ge=1, default=1)
    priority: int = Field(ge=1, le=3, default=2, description="1 is highest")


class Decomposition(BaseModel):
    requirements: list[RequirementDraft]


class NegotiationStrategy(BaseModel):
    counter_price: float = Field(description="the price to offer this round")
    concede_terms: list[str] = Field(default_factory=list)
    walk_away: bool = False
    rationale: str = ""
```

- [ ] **Step 4: Write the prompt**

```python
# cinex/llm/prompts/producer.py
from cinex.schemas.agents import CATEGORIES

DECOMPOSE = """You are a film production line producer breaking a brief into procurement line items.

Brief:
{text}

Budget cap: {budget_cap}
Location: {location}
Shoot dates: {start_date} to {end_date}

Break this into concrete, procurable requirements. Rules:
- category MUST be exactly one of: {categories}
- Infer what a real shoot needs even when the brief leaves it implicit. A night exterior
  implies lighting and a location permit; aerial shots imply a certified drone operator.
- Set spec.requires_certification to true for any crew role legally requiring a licence
  (drone operator, pyrotechnics, stunts, underwater).
- priority 1 for anything the shoot cannot happen without, 3 for nice-to-have.
- Do not invent a budget line for something the brief rules out.

Return JSON only."""


def build(text: str, budget_cap: str, location: str, start_date: str, end_date: str) -> str:
    return DECOMPOSE.format(
        text=text, budget_cap=budget_cap, location=location,
        start_date=start_date, end_date=end_date,
        categories=", ".join(CATEGORIES),
    )
```

Create empty `cinex/llm/prompts/__init__.py`.

- [ ] **Step 5: Implement the agent**

```python
# services/producer_agent/main.py
import uuid

from fastapi import FastAPI
from fastmcp import FastMCP

from cinex.audit import write_audit
from cinex.db.models import Requirement
from cinex.db.session import session_scope
from cinex.llm.gemini import get_llm
from cinex.llm.prompts import producer as prompts
from cinex.logging import get_logger
from cinex.schemas.agents import CATEGORIES, Decomposition

log = get_logger("producer-agent")
mcp = FastMCP("producer-agent")
AGENT = "producer-agent"


async def _decompose(
    production_id: str, text: str, budget_cap: str,
    location: str, start_date: str, end_date: str,
) -> dict:
    prompt = prompts.build(text, budget_cap, location, start_date, end_date)
    result: Decomposition = await get_llm().generate_json(prompt, Decomposition)

    invalid = [r.category for r in result.requirements if r.category not in CATEGORIES]
    if invalid:
        raise ValueError(f"model returned categories outside the allowed set: {invalid}")

    pid = uuid.UUID(production_id)
    drafted = []
    async with session_scope() as session:
        for draft in result.requirements:
            row = Requirement(
                production_id=pid, category=draft.category, spec=draft.spec,
                quantity=draft.quantity, priority=draft.priority,
            )
            session.add(row)
            await session.flush()
            drafted.append({
                "requirement_id": str(row.id), "category": row.category,
                "spec": row.spec, "quantity": row.quantity, "priority": row.priority,
            })
        await write_audit(
            session, actor=AGENT, action="decompose_brief",
            entity_type="production", entity_id=pid,
            payload={"brief": text, "model_output": result.model_dump(), "count": len(drafted)},
        )
    log.info("decomposed", extra={"production_id": production_id, "count": len(drafted)})
    return {"requirements": drafted}


@mcp.tool
async def decompose_brief(
    production_id: str, text: str, budget_cap: str,
    location: str, start_date: str, end_date: str,
) -> dict:
    """Turn an unstructured production brief into procurable requirement rows."""
    return await _decompose(production_id, text, budget_cap, location, start_date, end_date)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Producer Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
```

If Task 1's probe showed a different mount pattern, adjust these last five lines here first, then
copy the working pattern into Tasks 12, 13, 14, and 18.

- [ ] **Step 6: Run the tests**

Run: `uv run pytest tests/test_producer_agent.py -v -m integration`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add cinex/schemas cinex/llm/prompts services/producer_agent tests/test_producer_agent.py
git commit -m "feat: producer agent decomposing briefs into schema-validated requirements"
```

---

## Task 12: Marketplace Scout Agent

**Files:**
- Create: `services/scout_agent/__init__.py`, `services/scout_agent/ranking.py`, `services/scout_agent/main.py`
- Test: `tests/test_scout_ranking.py`, `tests/test_scout_agent.py`

**Interfaces:**
- Consumes: `request_with_retry`, `VendorUnavailable`, `write_audit`, `session_scope`, models `Vendor`, `Requirement`, `Offer`.
- Produces: `services.scout_agent.ranking.score(price, rating, available, cheapest) -> float`, `services.scout_agent.main._find_vendors(requirement_id, exclude_vendor_ids) -> dict`, MCP tool `find_vendors`, `app`.

`exclude_vendor_ids` is the parameter recovery depends on — build it now, not later.

- [ ] **Step 1: Write the failing ranking test**

```python
# tests/test_scout_ranking.py
from decimal import Decimal

from services.scout_agent.ranking import score


def test_cheaper_scores_higher_all_else_equal():
    cheap = score(Decimal("100"), Decimal("4.0"), True, Decimal("100"))
    dear = score(Decimal("200"), Decimal("4.0"), True, Decimal("100"))
    assert cheap > dear


def test_better_rated_scores_higher_all_else_equal():
    good = score(Decimal("100"), Decimal("5.0"), True, Decimal("100"))
    poor = score(Decimal("100"), Decimal("3.0"), True, Decimal("100"))
    assert good > poor


def test_unavailable_is_penalised_below_any_available_option():
    unavailable = score(Decimal("100"), Decimal("5.0"), False, Decimal("100"))
    available_but_worse = score(Decimal("500"), Decimal("3.0"), True, Decimal("100"))
    assert available_but_worse > unavailable
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_scout_ranking.py -v`
Expected: FAIL, `ModuleNotFoundError`

- [ ] **Step 3: Implement ranking**

```python
# services/scout_agent/ranking.py
"""Offer ranking. Pure, so the weighting is testable and arguable on stage."""
from decimal import Decimal

PRICE_WEIGHT = 0.6
RATING_WEIGHT = 0.4
UNAVAILABLE_PENALTY = 1000.0


def score(price: Decimal, rating: Decimal, available: bool, cheapest: Decimal) -> float:
    """Higher is better. Price is scored relative to the cheapest quote in the set."""
    price_ratio = float(cheapest / price) if price > 0 else 0.0
    rating_ratio = float(rating) / 5.0
    base = PRICE_WEIGHT * price_ratio + RATING_WEIGHT * rating_ratio
    return base - (0.0 if available else UNAVAILABLE_PENALTY)
```

- [ ] **Step 4: Write the failing agent test**

```python
# tests/test_scout_agent.py
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Offer, Requirement, Vendor

pytestmark = pytest.mark.integration


@pytest.fixture
async def requirement(session, production):
    r = Requirement(production_id=production.id, category="camera",
                    spec={"model": "Alexa"}, quantity=1, priority=1)
    session.add(r)
    for i, (name, base, endpoint) in enumerate([
        ("Cheap Cams", "1000.00", "http://v1"),
        ("Mid Cams", "1500.00", "http://v2"),
        ("Lux Cams", "3000.00", "http://v3"),
    ]):
        session.add(Vendor(
            id=uuid.UUID(int=100 + i, version=4), name=name, category="camera",
            rating=Decimal("4.0"), base_price=Decimal(base),
            availability_calendar={"blocked": []}, contact_meta={"endpoint": endpoint},
        ))
    await session.commit()
    await session.refresh(r)
    return r


@pytest.fixture
def quoting_vendors(monkeypatch):
    from services.scout_agent import main

    async def fake_request(method, url, **kwargs):
        base = Decimal(kwargs["params"]["base_price"])
        return {"price": str(base * Decimal("1.15")), "terms": {"cancellation": "48h"},
                "available": True}

    monkeypatch.setattr(main, "request_with_retry", fake_request)


async def test_returns_offers_ranked_cheapest_first(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    out = await _find_vendors(str(requirement.id), [])
    prices = [Decimal(o["price"]) for o in out["offers"]]
    assert prices == sorted(prices), "ranking must put the best offer first"
    assert out["offers"][0]["rank"] == 1


async def test_excluded_vendor_is_never_offered(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    excluded = str(uuid.UUID(int=100, version=4))
    out = await _find_vendors(str(requirement.id), [excluded])
    assert excluded not in {o["vendor_id"] for o in out["offers"]}
    assert len(out["offers"]) == 2


async def test_unreachable_vendor_falls_back_to_base_price_and_is_flagged(
    session, requirement, monkeypatch
):
    from cinex.http import VendorUnavailable
    from services.scout_agent import main

    async def flaky(method, url, **kwargs):
        if "v2" in url:
            raise VendorUnavailable("down")
        base = Decimal(kwargs["params"]["base_price"])
        return {"price": str(base * Decimal("1.15")), "terms": {}, "available": True}

    monkeypatch.setattr(main, "request_with_retry", flaky)

    out = await main._find_vendors(str(requirement.id), [])
    fallbacks = [o for o in out["offers"] if o["terms"].get("fallback")]
    assert len(fallbacks) == 1, "the unreachable vendor still produces a list-price offer"
    assert Decimal(fallbacks[0]["price"]) == Decimal("1500.00")

    audits = (await session.execute(select(AuditLog))).scalars().all()
    assert any(a.action == "vendor_fallback" for a in audits), \
        "a fallback must be visible in the trace, never silent"


async def test_offers_are_persisted_as_pending(session, requirement, quoting_vendors):
    from services.scout_agent.main import _find_vendors

    await _find_vendors(str(requirement.id), [])
    offers = (await session.execute(
        select(Offer).where(Offer.requirement_id == requirement.id)
    )).scalars().all()
    assert len(offers) == 3
    assert {o.status for o in offers} == {"pending"}
```

- [ ] **Step 5: Run to confirm failure**

Run: `uv run pytest tests/test_scout_agent.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.scout_agent.main'`

- [ ] **Step 6: Implement the agent**

```python
# services/scout_agent/main.py
import asyncio
import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.db.models import Offer, Requirement, Vendor
from cinex.db.session import session_scope
from cinex.http import VendorUnavailable, request_with_retry
from cinex.logging import get_logger
from services.scout_agent.ranking import score

log = get_logger("scout-agent")
mcp = FastMCP("scout-agent")
AGENT = "scout-agent"


async def _quote(vendor: Vendor, requirement: Requirement, start, end) -> tuple[Decimal, dict, bool]:
    endpoint = vendor.contact_meta["endpoint"]
    url = f"{endpoint}/vendors/{vendor.id}/quote"
    params = {
        "category": requirement.category,
        "quantity": requirement.quantity,
        "base_price": str(vendor.base_price),
        "start": start.isoformat(),
        "end": end.isoformat(),
    }
    try:
        body = await request_with_retry("GET", url, params=params)
        return Decimal(body["price"]), body.get("terms", {}), bool(body.get("available", True))
    except VendorUnavailable as exc:
        log.warning("quote_fallback", extra={"vendor_id": str(vendor.id), "error": str(exc)})
        return vendor.base_price, {"fallback": True, "reason": str(exc)}, True


async def _find_vendors(requirement_id: str, exclude_vendor_ids: list[str] | None = None) -> dict:
    excluded = {uuid.UUID(v) for v in (exclude_vendor_ids or [])}
    rid = uuid.UUID(requirement_id)

    async with session_scope() as session:
        requirement = (await session.execute(
            select(Requirement).where(Requirement.id == rid)
        )).scalar_one()
        production = (await session.execute(
            select(Requirement.production_id).where(Requirement.id == rid)
        )).scalar_one()
        from cinex.db.models import Production
        prod = (await session.execute(
            select(Production).where(Production.id == production)
        )).scalar_one()

        vendors = [
            v for v in (await session.execute(
                select(Vendor).where(Vendor.category == requirement.category)
            )).scalars().all()
            if v.id not in excluded
        ]

        quotes = await asyncio.gather(*[
            _quote(v, requirement, prod.start_date, prod.end_date) for v in vendors
        ])

        priced = [(v, p, t, a) for v, (p, t, a) in zip(vendors, quotes)]
        cheapest = min((p for _, p, _, _ in priced), default=Decimal("1"))

        ranked = sorted(
            priced,
            key=lambda row: score(row[1], row[0].rating, row[3], cheapest),
            reverse=True,
        )

        offers = []
        for rank, (vendor, price, terms, available) in enumerate(ranked, start=1):
            offer = Offer(
                requirement_id=rid, vendor_id=vendor.id, price=price,
                terms=terms, status="pending", round=0,
            )
            session.add(offer)
            await session.flush()
            if terms.get("fallback"):
                await write_audit(
                    session, actor=AGENT, action="vendor_fallback",
                    entity_type="offer", entity_id=offer.id,
                    payload={"vendor_id": str(vendor.id), "price": price,
                             "reason": terms.get("reason", "")},
                )
            offers.append({
                "offer_id": str(offer.id), "vendor_id": str(vendor.id),
                "vendor_name": vendor.name, "price": str(price),
                "terms": terms, "rank": rank,
            })

        await write_audit(
            session, actor=AGENT, action="find_vendors",
            entity_type="requirement", entity_id=rid,
            payload={"category": requirement.category, "considered": len(vendors),
                     "excluded": [str(e) for e in excluded], "offers": offers},
        )

    return {"offers": offers}


@mcp.tool
async def find_vendors(requirement_id: str, exclude_vendor_ids: list[str] | None = None) -> dict:
    """Discover candidate vendors for a requirement and collect initial offers.

    exclude_vendor_ids lets recovery re-scope the same requirement while skipping
    a vendor that has dropped out."""
    return await _find_vendors(requirement_id, exclude_vendor_ids)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Scout Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
```

- [ ] **Step 7: Run the tests**

Run: `uv run pytest tests/test_scout_ranking.py tests/test_scout_agent.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add services/scout_agent tests/test_scout_ranking.py tests/test_scout_agent.py
git commit -m "feat: scout agent with weighted ranking, vendor exclusion, and audited fallbacks"
```

---

## Task 13: Negotiation Agent

The centrepiece. Rounds are genuine HTTP exchanges against vendor processes; the strategy each
round comes from the LLM, which cannot see any reservation price.

**Files:**
- Create: `cinex/llm/prompts/negotiation.py`
- Create: `services/negotiation_agent/__init__.py`, `services/negotiation_agent/main.py`
- Test: `tests/test_negotiation_agent.py`

**Interfaces:**
- Consumes: `get_llm`, `NegotiationStrategy`, `request_with_retry`, `VendorUnavailable`, `write_audit`, models `Offer`, `Vendor`, `Requirement`.
- Produces: `services.negotiation_agent.main._negotiate(requirement_id, offer_ids, max_rounds) -> dict` returning keys `winning_offer_id`, `final_price`, `rounds`; MCP tool `negotiate`; `app`.
- `market_anchor(category)` is imported from `cinex.clickhouse` in Task 19. Until then it is defined locally in this module and moved in Task 19.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_negotiation_agent.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Offer, Requirement, Vendor
from cinex.schemas.agents import NegotiationStrategy

pytestmark = pytest.mark.integration


@pytest.fixture
async def offers(session, production):
    r = Requirement(production_id=production.id, category="camera", spec={}, quantity=1, priority=1)
    session.add(r)
    await session.flush()
    made = []
    for i, base in enumerate(["2000.00", "2400.00"]):
        v = Vendor(id=uuid.UUID(int=200 + i, version=4), name=f"V{i}", category="camera",
                   rating=Decimal("4.0"), base_price=Decimal(base),
                   availability_calendar={"blocked": []},
                   contact_meta={"endpoint": f"http://v{i}"})
        session.add(v)
        await session.flush()
        o = Offer(requirement_id=r.id, vendor_id=v.id,
                  price=Decimal(base) * Decimal("1.15"), terms={}, status="pending", round=0)
        session.add(o)
        await session.flush()
        made.append(o)
    await session.commit()
    return r, made


@pytest.fixture
def strategist(monkeypatch):
    from services.negotiation_agent import main
    llm = AsyncMock()
    llm.generate_json = AsyncMock(
        return_value=NegotiationStrategy(counter_price=1800.0, concede_terms=["flexible_dates"],
                                         walk_away=False, rationale="anchor below market")
    )
    monkeypatch.setattr(main, "get_llm", lambda: llm)
    return llm


async def test_converges_and_marks_a_single_winner(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers

    async def vendor(method, url, **kwargs):
        return {"decision": "accept", "price": kwargs["json"]["price"],
                "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    out = await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    assert out["winning_offer_id"] in {str(o.id) for o in made}
    rows = (await session.execute(
        select(Offer).where(Offer.requirement_id == r.id)
    )).scalars().all()
    assert sum(1 for o in rows if o.is_winner) == 1
    assert {o.status for o in rows} == {"accepted", "rejected"}


async def test_runs_multiple_rounds_when_the_vendor_counters(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers
    seen = []

    async def vendor(method, url, **kwargs):
        seen.append(kwargs["json"]["round"])
        if kwargs["json"]["round"] < 3:
            return {"decision": "counter", "price": "2100.00", "terms": {}, "message": "no"}
        return {"decision": "accept", "price": kwargs["json"]["price"], "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)
    assert max(seen) == 3, "must actually iterate rounds, not settle in one shot"


async def test_respects_the_round_cap(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers
    rounds = []

    async def stubborn(method, url, **kwargs):
        rounds.append(kwargs["json"]["round"])
        return {"decision": "counter", "price": "2200.00", "terms": {}, "message": "no"}

    monkeypatch.setattr(main, "request_with_retry", stubborn)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=2)
    assert max(rounds) == 2, "max_rounds must come from the caller, never a hardcoded 3"


async def test_every_round_is_audited(session, offers, strategist, monkeypatch):
    from services.negotiation_agent import main
    r, made = offers

    async def vendor(method, url, **kwargs):
        return {"decision": "accept", "price": kwargs["json"]["price"], "terms": {}, "message": "ok"}

    monkeypatch.setattr(main, "request_with_retry", vendor)
    await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=3)

    audits = (await session.execute(select(AuditLog))).scalars().all()
    round_entries = [a for a in audits if a.action == "negotiation_round"]
    assert len(round_entries) >= 2, "one entry per vendor per round, minimum"
    assert all("offered" in a.payload and "decision" in a.payload for a in round_entries)


async def test_all_vendors_rejecting_falls_back_to_the_best_standing_offer(
    session, offers, strategist, monkeypatch
):
    from services.negotiation_agent import main
    r, made = offers

    async def refusing(method, url, **kwargs):
        return {"decision": "reject", "price": "9999.00", "terms": {}, "message": "no"}

    monkeypatch.setattr(main, "request_with_retry", refusing)
    out = await main._negotiate(str(r.id), [str(o.id) for o in made], max_rounds=2)
    assert out["winning_offer_id"] is not None, "a rejection round must not leave the requirement empty"
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_negotiation_agent.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.negotiation_agent.main'`

- [ ] **Step 3: Write the prompt**

```python
# cinex/llm/prompts/negotiation.py
STRATEGY = """You are negotiating on behalf of a film producer to procure: {category}.

Round {round_no} of {max_rounds}.
Vendor: {vendor_name} (rating {rating})
Their current asking price: {current_ask}
Your last offer: {last_offer}
Median market price for this category: {market_anchor}
Terms you may concede: flexible_dates, extended_rental_days, bundled_units

You do not know this vendor's walk-away price. Infer it from how they have moved.

Rules:
- On the final round, offer something they can realistically accept - an unclosed deal is worse
  than a slightly expensive one.
- Conceding a term is often cheaper than conceding cash. Use it.
- Set walk_away only if their ask is more than double the market anchor.

Return JSON only."""


def build(category: str, round_no: int, max_rounds: int, vendor_name: str,
          rating: str, current_ask: str, last_offer: str, market_anchor: str) -> str:
    return STRATEGY.format(
        category=category, round_no=round_no, max_rounds=max_rounds,
        vendor_name=vendor_name, rating=rating, current_ask=current_ask,
        last_offer=last_offer, market_anchor=market_anchor,
    )
```

- [ ] **Step 4: Implement the agent**

```python
# services/negotiation_agent/main.py
import asyncio
import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Offer, Requirement, Vendor
from cinex.db.session import session_scope
from cinex.http import VendorUnavailable, request_with_retry
from cinex.llm.gemini import get_llm
from cinex.llm.prompts import negotiation as prompts
from cinex.logging import get_logger
from cinex.schemas.agents import NegotiationStrategy

log = get_logger("negotiation-agent")
mcp = FastMCP("negotiation-agent")
AGENT = "negotiation-agent"


async def market_anchor(category: str) -> Decimal:
    """Median market price. Task 19 replaces this body with the ClickHouse query."""
    async with session_scope() as session:
        prices = (await session.execute(
            select(Vendor.base_price).where(Vendor.category == category)
        )).scalars().all()
    if not prices:
        return Decimal("0")
    ordered = sorted(prices)
    return ordered[len(ordered) // 2]


async def _negotiate_one(session, offer: Offer, vendor: Vendor, requirement: Requirement,
                         max_rounds: int, anchor: Decimal) -> dict:
    session_id = str(uuid.uuid4())
    endpoint = vendor.contact_meta["endpoint"]
    url = f"{endpoint}/vendors/{vendor.id}/negotiate"

    current_ask = offer.price
    last_offer = offer.price
    outcome = {"offer_id": str(offer.id), "vendor_id": str(vendor.id),
               "settled": False, "price": offer.price, "rounds": []}

    for round_no in range(1, max_rounds + 1):
        prompt = prompts.build(
            category=requirement.category, round_no=round_no, max_rounds=max_rounds,
            vendor_name=vendor.name, rating=str(vendor.rating),
            current_ask=str(current_ask), last_offer=str(last_offer),
            market_anchor=str(anchor),
        )
        strategy: NegotiationStrategy = await get_llm().generate_json(prompt, NegotiationStrategy)

        if strategy.walk_away:
            await write_audit(
                session, actor=AGENT, action="negotiation_walk_away",
                entity_type="offer", entity_id=offer.id,
                payload={"round": round_no, "rationale": strategy.rationale},
            )
            break

        counter = Decimal(str(strategy.counter_price)).quantize(Decimal("0.01"))
        terms = {t: True for t in strategy.concede_terms}

        try:
            reply = await request_with_retry("POST", url, json={
                "session_id": session_id, "round": round_no,
                "price": str(counter), "terms": terms,
                "base_price": str(vendor.base_price),
            })
        except VendorUnavailable as exc:
            await write_audit(
                session, actor=AGENT, action="negotiation_vendor_unavailable",
                entity_type="offer", entity_id=offer.id,
                payload={"round": round_no, "error": str(exc)},
            )
            break

        decision = reply["decision"]
        vendor_price = Decimal(reply["price"])

        await write_audit(
            session, actor=AGENT, action="negotiation_round",
            entity_type="offer", entity_id=offer.id,
            payload={
                "round": round_no, "vendor_id": str(vendor.id), "vendor_name": vendor.name,
                "offered": counter, "conceded_terms": strategy.concede_terms,
                "rationale": strategy.rationale, "decision": decision,
                "vendor_price": vendor_price, "vendor_message": reply.get("message", ""),
            },
        )
        outcome["rounds"].append({
            "round": round_no, "offered": str(counter), "decision": decision,
            "vendor_price": str(vendor_price), "rationale": strategy.rationale,
        })

        last_offer = counter
        if decision == "accept":
            outcome.update(settled=True, price=vendor_price)
            offer.price = vendor_price
            offer.terms = {**offer.terms, **terms}
            break
        if decision == "reject":
            break
        current_ask = vendor_price

    offer.round = len(outcome["rounds"])
    offer.status = "negotiated"
    return outcome


async def _negotiate(requirement_id: str, offer_ids: list[str], max_rounds: int | None = None) -> dict:
    rounds_cap = max_rounds or get_settings().negotiation_max_rounds
    rid = uuid.UUID(requirement_id)
    wanted = [uuid.UUID(o) for o in offer_ids]

    async with session_scope() as session:
        requirement = (await session.execute(
            select(Requirement).where(Requirement.id == rid)
        )).scalar_one()
        offers = (await session.execute(
            select(Offer).where(Offer.id.in_(wanted))
        )).scalars().all()
        vendors = {
            v.id: v for v in (await session.execute(
                select(Vendor).where(Vendor.id.in_([o.vendor_id for o in offers]))
            )).scalars().all()
        }
        anchor = await market_anchor(requirement.category)

        outcomes = []
        for offer in offers:
            outcomes.append(
                await _negotiate_one(session, offer, vendors[offer.vendor_id],
                                     requirement, rounds_cap, anchor)
            )

        settled = [o for o in outcomes if o["settled"]]
        pool = settled or outcomes
        best = min(pool, key=lambda o: o["price"])

        for offer in offers:
            if str(offer.id) == best["offer_id"]:
                offer.status, offer.is_winner = "accepted", True
            else:
                offer.status, offer.is_winner = "rejected", False

        await write_audit(
            session, actor=AGENT, action="negotiate",
            entity_type="requirement", entity_id=rid,
            payload={"max_rounds": rounds_cap, "anchor": anchor,
                     "winner": best["offer_id"], "final_price": best["price"],
                     "settled_count": len(settled), "outcomes": outcomes},
        )

    return {
        "winning_offer_id": best["offer_id"],
        "final_price": str(best["price"]),
        "rounds": [r for o in outcomes for r in o["rounds"]],
    }


@mcp.tool
async def negotiate(requirement_id: str, offer_ids: list[str], max_rounds: int | None = None) -> dict:
    """Run multi-round negotiation against every candidate vendor and pick a winner."""
    return await _negotiate(requirement_id, offer_ids, max_rounds)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Negotiation Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_negotiation_agent.py -v -m integration`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add cinex/llm/prompts/negotiation.py services/negotiation_agent tests/test_negotiation_agent.py
git commit -m "feat: negotiation agent running real multi-round vendor exchanges with audited rounds"
```

---

## Task 14: Compliance rules and approval threshold (pure logic)

No LLM anywhere in this task. The approval gate must be deterministic and arguable.

**Files:**
- Create: `services/compliance_agent/__init__.py`, `services/compliance_agent/rules.py`
- Test: `tests/test_compliance_rules.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CheckResult` (frozen dataclass: `check_type: str`, `status: str`, `evidence: dict`)
  - `ApprovalDecision` (frozen dataclass: `required: bool`, `reasons: list[str]`, `delta_amount: Decimal`, `delta_pct: float`, `threshold_breached: bool`)
  - `check_permit(location, start_date, end_date, categories) -> CheckResult`
  - `check_insurance(equipment_value, threshold) -> CheckResult`
  - `check_licensing(crew_specs) -> CheckResult`
  - `evaluate_approval(total_cost, budget_cap, baseline, check_statuses, threshold_pct) -> ApprovalDecision`
  - `PERMIT_REGISTRY: dict[str, dict]`, `CREDENTIAL_REGISTRY: dict[str, bool]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_compliance_rules.py
from datetime import date
from decimal import Decimal

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
```

Add `import pytest` at the top of that file for `pytest.approx`.

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_compliance_rules.py -v`
Expected: FAIL, `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# services/compliance_agent/rules.py
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
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_compliance_rules.py -v`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add services/compliance_agent/rules.py tests/test_compliance_rules.py
git commit -m "feat: deterministic compliance rules and a single approval-gate function"
```

---

## Task 15: Compliance Agent service

**Files:**
- Create: `services/compliance_agent/main.py`
- Test: `tests/test_compliance_agent.py`

**Interfaces:**
- Consumes: everything from `services.compliance_agent.rules`; models `Production`, `Requirement`, `Offer`, `ComplianceCheck`, `Approval`.
- Produces: MCP tools `check_compliance(production_id) -> dict` (keys `checks`, `overall`) and `request_approval(production_id, reason, delta_amount, threshold_breached) -> dict` (keys `approval_id`, `status`); helpers `_check_compliance`, `_request_approval`; `app`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_compliance_agent.py
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from cinex.db.models import Approval, ComplianceCheck, Offer, Requirement, Vendor

pytestmark = pytest.mark.integration


@pytest.fixture
async def priced_production(session, production):
    r = Requirement(production_id=production.id, category="crew",
                    spec={"role": "drone operator", "requires_certification": True},
                    quantity=1, priority=1)
    loc = Requirement(production_id=production.id, category="location",
                      spec={"site": "Praca do Comercio"}, quantity=1, priority=1)
    session.add_all([r, loc])
    await session.flush()
    v = Vendor(id=uuid.uuid4(), name="Aerial", category="crew", rating=Decimal("4.5"),
               base_price=Decimal("3000.00"), availability_calendar={"blocked": []},
               contact_meta={"endpoint": "http://v1"})
    session.add(v)
    await session.flush()
    session.add(Offer(requirement_id=r.id, vendor_id=v.id, price=Decimal("3000.00"),
                      terms={}, status="accepted", round=1, is_winner=True))
    await session.commit()
    return production


async def test_check_compliance_writes_three_checks(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    assert {c["check_type"] for c in out["checks"]} == {"permit", "insurance", "licensing"}

    rows = (await session.execute(
        select(ComplianceCheck).where(ComplianceCheck.production_id == priced_production.id)
    )).scalars().all()
    assert len(rows) == 3


async def test_uncredentialled_drone_operator_fails_overall(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    licensing = next(c for c in out["checks"] if c["check_type"] == "licensing")
    assert licensing["status"] == "fail"
    assert out["overall"] == "fail"


async def test_evidence_is_labelled_as_mock(session, priced_production):
    from services.compliance_agent.main import _check_compliance

    out = await _check_compliance(str(priced_production.id))
    assert all("MOCK DATA" in c["evidence"]["disclaimer"] for c in out["checks"])


async def test_request_approval_creates_a_pending_row(session, priced_production):
    from services.compliance_agent.main import _request_approval

    out = await _request_approval(
        str(priced_production.id), reason="threshold_breached",
        delta_amount="15000.00", threshold_breached=True,
    )
    approval = (await session.execute(
        select(Approval).where(Approval.id == uuid.UUID(out["approval_id"]))
    )).scalar_one()
    assert approval.producer_decision == "pending"
    assert approval.requested_by_agent == "compliance-agent"
    assert approval.delta_amount == Decimal("15000.00")
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_compliance_agent.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.compliance_agent.main'`

- [ ] **Step 3: Implement**

```python
# services/compliance_agent/main.py
import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Approval, ComplianceCheck, Offer, Production, Requirement
from cinex.db.session import session_scope
from cinex.logging import get_logger
from services.compliance_agent.rules import (
    check_insurance, check_licensing, check_permit, evaluate_approval,
)

log = get_logger("compliance-agent")
mcp = FastMCP("compliance-agent")
AGENT = "compliance-agent"
EQUIPMENT_CATEGORIES = {"camera", "transport"}


async def _check_compliance(production_id: str) -> dict:
    pid = uuid.UUID(production_id)
    settings = get_settings()

    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        requirements = (await session.execute(
            select(Requirement).where(Requirement.production_id == pid)
        )).scalars().all()

        categories = {r.category for r in requirements}
        crew_specs = [r.spec for r in requirements if r.category == "crew"]

        equipment_ids = [r.id for r in requirements if r.category in EQUIPMENT_CATEGORIES]
        equipment_value = Decimal("0")
        if equipment_ids:
            winning = (await session.execute(
                select(Offer).where(Offer.requirement_id.in_(equipment_ids), Offer.is_winner.is_(True))
            )).scalars().all()
            equipment_value = sum((o.price for o in winning), Decimal("0"))

        results = [
            check_permit(production.location, production.start_date, production.end_date, categories),
            check_insurance(equipment_value, Decimal(str(settings.insurance_rider_threshold))),
            check_licensing(crew_specs),
        ]

        checks = []
        for result in results:
            session.add(ComplianceCheck(
                production_id=pid, check_type=result.check_type,
                status=result.status, evidence=result.evidence,
            ))
            checks.append({
                "check_type": result.check_type, "status": result.status,
                "evidence": result.evidence,
            })

        overall = "fail" if any(c["status"] == "fail" for c in checks) else "pass"
        await write_audit(
            session, actor=AGENT, action="check_compliance",
            entity_type="production", entity_id=pid,
            payload={"checks": checks, "overall": overall,
                     "equipment_value": equipment_value},
        )

    return {"checks": checks, "overall": overall}


async def _request_approval(
    production_id: str, reason: str, delta_amount: str, threshold_breached: bool
) -> dict:
    pid = uuid.UUID(production_id)
    async with session_scope() as session:
        approval = Approval(
            production_id=pid, requested_by_agent=AGENT, reason=reason,
            threshold_breached=threshold_breached, delta_amount=Decimal(delta_amount),
            producer_decision="pending",
        )
        session.add(approval)
        await session.flush()
        await write_audit(
            session, actor=AGENT, action="request_approval",
            entity_type="approval", entity_id=approval.id,
            payload={"production_id": str(pid), "reason": reason,
                     "delta_amount": delta_amount, "threshold_breached": threshold_breached},
        )
        approval_id = str(approval.id)

    log.info("approval_requested", extra={"production_id": production_id, "reason": reason})
    return {"approval_id": approval_id, "status": "pending"}


@mcp.tool
async def check_compliance(production_id: str) -> dict:
    """Run permit, insurance, and licensing checks against mock registries."""
    return await _check_compliance(production_id)


@mcp.tool
async def request_approval(
    production_id: str, reason: str, delta_amount: str, threshold_breached: bool = False
) -> dict:
    """Open a producer approval gate."""
    return await _request_approval(production_id, reason, delta_amount, threshold_breached)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Compliance Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_compliance_agent.py -v -m integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/compliance_agent/main.py tests/test_compliance_agent.py
git commit -m "feat: compliance agent with mock-labelled evidence and producer approval gate"
```

---

## Task 16: Orchestrator pipeline (the 10 steps)

**Files:**
- Create: `services/orchestrator/__init__.py`, `services/orchestrator/pipeline.py`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: `get_agents`, `emit_step`, `write_audit`, `session_scope`, models.
- Produces:
  - `run_happy_path(production_id: uuid.UUID) -> None`
  - `resume_after_approval(production_id: uuid.UUID) -> None`
  - `create_bookings(session, production_id) -> list[Booking]`
  - `STEPS: tuple[tuple[int, str], ...]` — the canonical (number, name) list

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import Approval, Booking, Offer, Production, Requirement, Vendor
from cinex.steps import read_steps

pytestmark = pytest.mark.integration


@pytest.fixture
async def wired(session, production, monkeypatch):
    """Fake the five agents. The pipeline's own sequencing is what is under test."""
    from services.orchestrator import pipeline

    vendor = Vendor(id=uuid.uuid4(), name="V", category="camera", rating=Decimal("4.0"),
                    base_price=Decimal("2000.00"), availability_calendar={"blocked": []},
                    contact_meta={"endpoint": "http://v1"})
    session.add(vendor)
    await session.commit()

    state = {}

    async def fake_call(agent, tool, args):
        if tool == "decompose_brief":
            async with pipeline.session_scope() as s:
                r = Requirement(production_id=production.id, category="camera",
                                spec={}, quantity=1, priority=1)
                s.add(r)
                await s.flush()
                state["requirement_id"] = str(r.id)
            return {"requirements": [{"requirement_id": state["requirement_id"],
                                      "category": "camera", "spec": {},
                                      "quantity": 1, "priority": 1}]}
        if tool == "find_vendors":
            async with pipeline.session_scope() as s:
                o = Offer(requirement_id=uuid.UUID(args["requirement_id"]),
                          vendor_id=vendor.id, price=Decimal("2300.00"),
                          terms={}, status="pending", round=0)
                s.add(o)
                await s.flush()
                state["offer_id"] = str(o.id)
            return {"offers": [{"offer_id": state["offer_id"], "vendor_id": str(vendor.id),
                                "price": "2300.00", "terms": {}, "rank": 1}]}
        if tool == "negotiate":
            async with pipeline.session_scope() as s:
                o = (await s.execute(
                    select(Offer).where(Offer.id == uuid.UUID(state["offer_id"]))
                )).scalar_one()
                o.price = Decimal("1900.00")
                o.status, o.is_winner = "accepted", True
            return {"winning_offer_id": state["offer_id"], "final_price": "1900.00", "rounds": []}
        if tool == "check_compliance":
            return {"checks": [{"check_type": "permit", "status": "pass", "evidence": {}}],
                    "overall": "pass"}
        if tool == "request_approval":
            return {"approval_id": str(uuid.uuid4()), "status": "pending"}
        raise AssertionError(f"unexpected tool {tool}")

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=fake_call)
    monkeypatch.setattr(pipeline, "get_agents", lambda: agents)
    return production, agents, state


async def test_all_ten_steps_are_emitted_in_order(session, wired):
    from services.orchestrator.pipeline import STEPS, run_happy_path
    production, _, _ = wired

    await run_happy_path(production.id)

    steps = await read_steps(session, production.id)
    done = [s.step for s in steps if s.status == "done"]
    assert done == [n for n, _ in STEPS], "every step must report done, in order"


async def test_happy_path_creates_a_booking(session, wired):
    from services.orchestrator.pipeline import run_happy_path
    production, _, _ = wired

    await run_happy_path(production.id)

    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == production.id)
    )).scalars().all()
    assert len(bookings) == 1
    assert bookings[0].final_price == Decimal("1900.00")
    assert bookings[0].status == "confirmed"

    await session.refresh(production)
    assert production.status == "booked"
    assert production.total_cost == Decimal("1900.00")


async def test_over_budget_parks_at_awaiting_approval_and_books_nothing(session, production, wired, monkeypatch):
    from services.orchestrator import pipeline
    prod, agents, _ = wired

    async with pipeline.session_scope() as s:
        p = (await s.execute(select(Production).where(Production.id == prod.id))).scalar_one()
        p.budget_cap = Decimal("100.00")

    await pipeline.run_happy_path(prod.id)

    await session.refresh(prod)
    assert prod.status == "awaiting_approval"
    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == prod.id)
    )).scalars().all()
    assert bookings == [], "nothing may be booked while an approval is pending"


async def test_resume_after_approval_books(session, production, wired):
    from services.orchestrator import pipeline
    prod, _, _ = wired

    async with pipeline.session_scope() as s:
        p = (await s.execute(select(Production).where(Production.id == prod.id))).scalar_one()
        p.budget_cap = Decimal("100.00")

    await pipeline.run_happy_path(prod.id)
    await pipeline.resume_after_approval(prod.id)

    bookings = (await session.execute(
        select(Booking).where(Booking.production_id == prod.id)
    )).scalars().all()
    assert len(bookings) == 1


async def test_agent_failure_marks_the_production_failed(session, production, monkeypatch):
    from cinex.mcp_client import AgentUnavailable
    from services.orchestrator import pipeline

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=AgentUnavailable("producer-agent down"))
    monkeypatch.setattr(pipeline, "get_agents", lambda: agents)

    await pipeline.run_happy_path(production.id)

    await session.refresh(production)
    assert production.status == "failed"
    steps = await read_steps(session, production.id)
    assert any(s.status == "failed" for s in steps), "a failure must be visible on the stream"
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_pipeline.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.orchestrator.pipeline'`

- [ ] **Step 3: Implement**

```python
# services/orchestrator/pipeline.py
"""The 10-step happy path.

An explicit sequence of agent tool calls. Deliberately not one large prompt
pretending to be five agents - each numbered step below is a real network hop.
"""
import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Approval, Booking, Offer, Production, Requirement
from cinex.db.session import session_scope
from cinex.logging import get_logger
from cinex.mcp_client import AgentUnavailable, get_agents
from cinex.steps import emit_step

log = get_logger("orchestrator")
ACTOR = "orchestrator"

STEPS: tuple[tuple[int, str], ...] = (
    (1, "ingest"),
    (2, "decompose"),
    (3, "discover"),
    (4, "solicit"),
    (5, "shortlist"),
    (6, "negotiate"),
    (7, "total"),
    (8, "compliance"),
    (9, "approval_gate"),
    (10, "book"),
)
_NAMES = dict(STEPS)


async def _set_status(production_id: uuid.UUID, status: str, step: int | None = None) -> None:
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one()
        production.status = status
        if step is not None:
            production.current_step = step


async def _step(production_id: uuid.UUID, number: int, status: str, detail: dict | None = None) -> None:
    async with session_scope() as session:
        await emit_step(session, production_id, number, _NAMES[number], status, detail)


async def create_bookings(session, production_id: uuid.UUID) -> list[Booking]:
    """Turn every winning offer into a confirmed booking. Idempotent."""
    requirement_ids = (await session.execute(
        select(Requirement.id).where(Requirement.production_id == production_id)
    )).scalars().all()
    winners = (await session.execute(
        select(Offer).where(Offer.requirement_id.in_(requirement_ids), Offer.is_winner.is_(True))
    )).scalars().all()
    already = set((await session.execute(
        select(Booking.offer_id).where(Booking.production_id == production_id)
    )).scalars().all())

    made = []
    for offer in winners:
        if offer.id in already:
            continue
        booking = Booking(production_id=production_id, offer_id=offer.id,
                          final_price=offer.price, status="confirmed")
        session.add(booking)
        await session.flush()
        made.append(booking)
    return made


async def _total_cost(session, production_id: uuid.UUID) -> Decimal:
    requirement_ids = (await session.execute(
        select(Requirement.id).where(Requirement.production_id == production_id)
    )).scalars().all()
    winners = (await session.execute(
        select(Offer.price).where(Offer.requirement_id.in_(requirement_ids), Offer.is_winner.is_(True))
    )).scalars().all()
    return sum(winners, Decimal("0"))


async def run_happy_path(production_id: uuid.UUID) -> None:
    agents = get_agents()
    settings = get_settings()
    current = 1
    try:
        # 1 - ingest
        await _step(production_id, 1, "in_progress")
        async with session_scope() as session:
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            brief = {
                "text": production.brief_text,
                "budget_cap": str(production.budget_cap),
                "location": production.location,
                "start_date": production.start_date.isoformat(),
                "end_date": production.end_date.isoformat(),
            }
            budget_cap = production.budget_cap
        await _step(production_id, 1, "done", {"brief_chars": len(brief["text"])})

        # 2 - decompose
        current = 2
        await _set_status(production_id, "decomposing", 2)
        await _step(production_id, 2, "in_progress")
        decomposed = await agents.call("producer", "decompose_brief",
                                       {"production_id": str(production_id), **brief})
        requirements = decomposed["requirements"]
        await _step(production_id, 2, "done", {"requirements": len(requirements)})

        # 3, 4, 5 - discover, solicit, shortlist (one Scout call covers all three)
        current = 3
        await _set_status(production_id, "scouting", 3)
        for number in (3, 4, 5):
            await _step(production_id, number, "in_progress")

        scouted = await asyncio.gather(*[
            agents.call("scout", "find_vendors", {"requirement_id": r["requirement_id"]})
            for r in requirements
        ])
        offers_by_requirement = {
            r["requirement_id"]: s["offers"] for r, s in zip(requirements, scouted)
        }
        total_offers = sum(len(v) for v in offers_by_requirement.values())
        await _step(production_id, 3, "done", {"requirements_scouted": len(requirements)})
        await _step(production_id, 4, "done", {"offers": total_offers})
        await _step(production_id, 5, "done", {
            "shortlisted": {k: len(v) for k, v in offers_by_requirement.items()}
        })

        # 6 - negotiate, concurrent across requirements
        current = 6
        await _set_status(production_id, "negotiating", 6)
        await _step(production_id, 6, "in_progress")
        negotiated = await asyncio.gather(*[
            agents.call("negotiation", "negotiate", {
                "requirement_id": requirement_id,
                "offer_ids": [o["offer_id"] for o in offers],
                "max_rounds": settings.negotiation_max_rounds,
            })
            for requirement_id, offers in offers_by_requirement.items()
            if offers
        ])
        await _step(production_id, 6, "done", {
            "negotiated": len(negotiated),
            "rounds": sum(len(n.get("rounds", [])) for n in negotiated),
        })

        # 7 - total
        current = 7
        await _step(production_id, 7, "in_progress")
        async with session_scope() as session:
            total = await _total_cost(session, production_id)
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            production.total_cost = total
            production.current_step = 7
            await write_audit(session, actor=ACTOR, action="compute_total",
                              entity_type="production", entity_id=production_id,
                              payload={"total_cost": total, "budget_cap": budget_cap})
        await _step(production_id, 7, "done", {"total_cost": str(total),
                                               "budget_cap": str(budget_cap)})

        # 8 - compliance
        current = 8
        await _set_status(production_id, "compliance", 8)
        await _step(production_id, 8, "in_progress")
        compliance = await agents.call("compliance", "check_compliance",
                                       {"production_id": str(production_id)})
        await _step(production_id, 8, "done", {"overall": compliance["overall"],
                                               "checks": len(compliance["checks"])})

        # 9 - approval gate
        current = 9
        await _step(production_id, 9, "in_progress")
        from services.compliance_agent.rules import evaluate_approval
        decision = evaluate_approval(
            total_cost=total,
            budget_cap=budget_cap,
            baseline=budget_cap,
            check_statuses=[c["status"] for c in compliance["checks"]],
            threshold_pct=settings.approval_threshold_pct,
        )
        if decision.required:
            approval = await agents.call("compliance", "request_approval", {
                "production_id": str(production_id),
                "reason": ",".join(decision.reasons),
                "delta_amount": str(decision.delta_amount),
                "threshold_breached": decision.threshold_breached,
            })
            await _set_status(production_id, "awaiting_approval", 9)
            await _step(production_id, 9, "done", {
                "approval_required": True, "approval_id": approval["approval_id"],
                "reasons": decision.reasons, "delta_amount": str(decision.delta_amount),
                "delta_pct": round(decision.delta_pct, 2),
            })
            await _step(production_id, 9, "in_progress", {"waiting_on": "producer"})
            log.info("parked_for_approval", extra={"production_id": str(production_id)})
            return
        await _step(production_id, 9, "done", {"approval_required": False})

        # 10 - book
        await _book(production_id)

    except AgentUnavailable as exc:
        await _fail(production_id, current, str(exc))
    except Exception as exc:  # noqa: BLE001 - nothing may fail silently
        log.exception("pipeline_error", extra={"production_id": str(production_id)})
        await _fail(production_id, current, str(exc))


async def _book(production_id: uuid.UUID) -> None:
    await _step(production_id, 10, "in_progress")
    async with session_scope() as session:
        made = await create_bookings(session, production_id)
        total = await _total_cost(session, production_id)
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one()
        production.status = "booked"
        production.current_step = 10
        production.total_cost = total
        await write_audit(session, actor=ACTOR, action="create_bookings",
                          entity_type="production", entity_id=production_id,
                          payload={"bookings": [str(b.id) for b in made], "total_cost": total})
    await _step(production_id, 10, "done", {"bookings": len(made), "total_cost": str(total)})
    await _step(production_id, 10, "done", {"terminal": "booked"})


async def _fail(production_id: uuid.UUID, step: int, reason: str) -> None:
    await _set_status(production_id, "failed", step)
    async with session_scope() as session:
        await write_audit(session, actor=ACTOR, action="pipeline_failed",
                          entity_type="production", entity_id=production_id,
                          payload={"step": step, "reason": reason})
    await _step(production_id, step, "failed", {"reason": reason})


async def resume_after_approval(production_id: uuid.UUID) -> None:
    """Called once the producer approves. Picks up at step 10 - the brief is
    never resubmitted."""
    await _book(production_id)
```

Note the double `done` emit at step 10: the first carries the counts, the second carries the
terminal marker the SSE consumer closes on. Both are real rows; neither is cosmetic.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_pipeline.py -v -m integration`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add services/orchestrator/pipeline.py tests/test_pipeline.py
git commit -m "feat: 10-step orchestrator pipeline with an explicit approval gate"
```

---

## Task 17: Orchestrator API surface

**Files:**
- Create: `services/orchestrator/main.py`
- Test: `tests/test_orchestrator_api.py`

**Interfaces:**
- Consumes: `run_happy_path`, `resume_after_approval`, `require_producer`, `issue_demo_token`, `read_steps`, `get_agents`.
- Produces: FastAPI `app` with the eight endpoints from spec §7.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_orchestrator_api.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from cinex.auth import issue_demo_token
from cinex.db.models import Approval, Production

pytestmark = pytest.mark.integration


@pytest.fixture
async def client(monkeypatch):
    from services.orchestrator import main
    monkeypatch.setattr(main, "run_happy_path", AsyncMock())
    monkeypatch.setattr(main, "resume_after_approval", AsyncMock())
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as c:
        yield c


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {issue_demo_token()}"}


async def test_token_endpoint_issues_a_usable_token(client):
    r = await client.post("/auth/token")
    assert r.status_code == 200
    assert r.json()["access_token"]


async def test_create_production_returns_202_immediately(client, auth):
    r = await client.post("/productions", headers=auth, json={
        "brief_text": "Two-day shoot in Lisbon with aerial coverage",
        "budget_cap": "120000.00", "location": "Lisbon",
        "start_date": "2026-09-01", "end_date": "2026-09-02",
    })
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "draft"
    uuid.UUID(body["production_id"])


async def test_create_production_requires_auth(client):
    r = await client.post("/productions", json={
        "brief_text": "x", "budget_cap": "1.00", "location": "Lisbon",
        "start_date": "2026-09-01", "end_date": "2026-09-02",
    })
    assert r.status_code == 403


async def test_status_reports_steps(client, auth, session, production):
    from cinex.steps import emit_step
    await emit_step(session, production.id, 2, "decompose", "done", {"requirements": 4})
    await session.commit()

    r = await client.get(f"/productions/{production.id}/status", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "draft"
    assert body["steps"][-1]["name"] == "decompose"


async def test_trace_returns_the_full_ordered_audit_log(client, auth, session, production):
    from cinex.audit import write_audit
    await write_audit(session, actor="scout-agent", action="find_vendors",
                      entity_type="production", entity_id=production.id, payload={"n": 3})
    await session.commit()

    r = await client.get(f"/productions/{production.id}/trace", headers=auth)
    assert r.status_code == 200
    actors = {entry["actor"] for entry in r.json()["trace"]}
    assert "scout-agent" in actors


async def test_decide_approval_approves_and_resumes(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="threshold_breached", threshold_breached=True,
                        delta_amount=Decimal("100.00"))
    session.add(approval)
    await session.commit()

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "approved"})
    assert r.status_code == 200
    await session.refresh(approval)
    assert approval.producer_decision == "approved"
    assert approval.decided_at is not None


async def test_rejecting_an_approval_fails_the_production(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="over_budget_cap", threshold_breached=False,
                        delta_amount=Decimal("100.00"))
    session.add(approval)
    await session.commit()

    await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                      json={"decision": "rejected"})
    await session.refresh(production)
    assert production.status == "failed"


async def test_deciding_twice_is_rejected(client, auth, session, production):
    approval = Approval(production_id=production.id, requested_by_agent="compliance-agent",
                        reason="x", threshold_breached=False, delta_amount=Decimal("0"),
                        producer_decision="approved")
    session.add(approval)
    await session.commit()

    r = await client.post(f"/approvals/{approval.id}/decide", headers=auth,
                          json={"decision": "rejected"})
    assert r.status_code == 409
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_orchestrator_api.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.orchestrator.main'`

- [ ] **Step 3: Implement**

```python
# services/orchestrator/main.py
import asyncio
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.auth import Producer, issue_demo_token, require_producer
from cinex.config import get_settings
from cinex.db.models import Approval, AuditLog, Production
from cinex.db.session import init_db, session_scope
from cinex.logging import get_logger
from cinex.mcp_client import get_agents
from cinex.steps import read_steps
from services.orchestrator.pipeline import resume_after_approval, run_happy_path

log = get_logger("orchestrator-api")
app = FastAPI(title="CineXchange Orchestrator")
SSE_POLL_SECONDS = 0.5
SSE_MAX_SECONDS = 300
TERMINAL = {"booked", "failed", "awaiting_approval"}


class ProductionRequest(BaseModel):
    brief_text: str = Field(min_length=10)
    budget_cap: Decimal
    location: str
    start_date: date
    end_date: date


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")


@app.on_event("startup")
async def startup() -> None:
    await init_db()


@app.get("/healthz")
async def healthz() -> dict:
    agents = get_agents()
    reachable = {}
    for name in get_settings().agent_urls():
        try:
            reachable[name] = await agents.list_tools(name)
        except Exception as exc:  # noqa: BLE001 - health must report, not raise
            reachable[name] = f"unreachable: {exc}"
    return {"ok": True, "agents": reachable}


@app.post("/auth/token")
async def token() -> dict:
    return {"access_token": issue_demo_token(), "token_type": "bearer"}


@app.post("/productions", status_code=202)
async def create_production(
    body: ProductionRequest,
    background: BackgroundTasks,
    producer: Producer = Depends(require_producer),
) -> dict:
    async with session_scope() as session:
        production = Production(
            producer_id=producer.id, brief_text=body.brief_text, budget_cap=body.budget_cap,
            location=body.location, start_date=body.start_date, end_date=body.end_date,
            status="draft",
        )
        session.add(production)
        await session.flush()
        production_id = production.id
        await write_audit(session, actor="producer", action="submit_brief",
                          entity_type="production", entity_id=production_id,
                          payload={"budget_cap": body.budget_cap, "location": body.location})

    background.add_task(run_happy_path, production_id)
    return {"production_id": str(production_id), "status": "draft"}


@app.get("/productions/{production_id}/status")
async def status(production_id: uuid.UUID, _: Producer = Depends(require_producer)) -> dict:
    async with session_scope() as session:
        production = (await session.execute(
            select(Production).where(Production.id == production_id)
        )).scalar_one_or_none()
        if production is None:
            raise HTTPException(status_code=404, detail="unknown production")
        steps = await read_steps(session, production_id)
        pending = (await session.execute(
            select(Approval).where(Approval.production_id == production_id,
                                   Approval.producer_decision == "pending")
        )).scalars().first()

    return {
        "production_id": str(production_id),
        "status": production.status,
        "current_step": production.current_step,
        "total_cost": str(production.total_cost) if production.total_cost is not None else None,
        "budget_cap": str(production.budget_cap),
        "pending_approval_id": str(pending.id) if pending else None,
        "steps": [
            {"step": s.step, "name": s.name, "status": s.status,
             "detail": s.detail, "ts": s.ts.isoformat()}
            for s in steps
        ],
    }


@app.get("/productions/{production_id}/events")
async def events(production_id: uuid.UUID) -> StreamingResponse:
    """SSE over the same DB projection /status reads, so the two cannot disagree."""
    async def stream():
        cursor: datetime | None = None
        waited = 0.0
        while waited < SSE_MAX_SECONDS:
            async with session_scope() as session:
                fresh = await read_steps(session, production_id, after=cursor)
                production = (await session.execute(
                    select(Production.status).where(Production.id == production_id)
                )).scalar_one_or_none()
            for event in fresh:
                cursor = event.ts
                yield event.sse()
            if production in TERMINAL:
                yield f"event: end\ndata: {{\"status\": \"{production}\"}}\n\n"
                return
            await asyncio.sleep(SSE_POLL_SECONDS)
            waited += SSE_POLL_SECONDS

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/productions/{production_id}/trace")
async def trace(production_id: uuid.UUID, _: Producer = Depends(require_producer)) -> dict:
    """Every agent decision for this production, in order. The answer to
    'prove this isn't scripted'."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(AuditLog).where(
                (AuditLog.entity_id == production_id)
                | (AuditLog.payload["production_id"].astext == str(production_id))
            ).order_by(AuditLog.created_at, AuditLog.id)
        )).scalars().all()

    return {
        "production_id": str(production_id),
        "entries": len(rows),
        "actors": sorted({r.actor for r in rows}),
        "trace": [
            {"ts": r.created_at.isoformat(), "actor": r.actor, "action": r.action,
             "entity_type": r.entity_type, "entity_id": str(r.entity_id) if r.entity_id else None,
             "payload": r.payload}
            for r in rows
        ],
    }


@app.post("/approvals/{approval_id}/decide")
async def decide(
    approval_id: uuid.UUID,
    body: ApprovalDecisionRequest,
    background: BackgroundTasks,
    _: Producer = Depends(require_producer),
) -> dict:
    async with session_scope() as session:
        approval = (await session.execute(
            select(Approval).where(Approval.id == approval_id)
        )).scalar_one_or_none()
        if approval is None:
            raise HTTPException(status_code=404, detail="unknown approval")
        if approval.producer_decision != "pending":
            raise HTTPException(status_code=409, detail="already decided")

        approval.producer_decision = body.decision
        approval.decided_at = datetime.now(timezone.utc)
        production_id = approval.production_id

        await write_audit(session, actor="producer", action=f"approval_{body.decision}",
                          entity_type="approval", entity_id=approval_id,
                          payload={"production_id": str(production_id)})

        if body.decision == "rejected":
            production = (await session.execute(
                select(Production).where(Production.id == production_id)
            )).scalar_one()
            production.status = "failed"

    if body.decision == "approved":
        background.add_task(resume_after_approval, production_id)

    return {"approval_id": str(approval_id), "decision": body.decision,
            "production_id": str(production_id)}
```

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_orchestrator_api.py -v -m integration`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add services/orchestrator/main.py tests/test_orchestrator_api.py
git commit -m "feat: orchestrator REST surface with SSE, trace, and producer approval decisions"
```

---

## Task 18: Docker Compose and the Criterion 1 gate

**This is the gate. No work on Task 19 or beyond begins until every check in Step 6 passes.**

**Files:**
- Create: `docker-compose.yml`, `scripts/demo_happy_path.sh`
- Test: `tests/test_integration_happy_path.py`

**Interfaces:**
- Consumes: every service built so far.
- Produces: a running seven-container stack, and `tests/test_integration_happy_path.py::test_full_happy_path`.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
name: cinexchange

x-app: &app
  build: .
  env_file: [.env]
  depends_on:
    postgres: {condition: service_healthy}

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: cinex
      POSTGRES_PASSWORD: cinex
      POSTGRES_DB: cinex
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cinex"]
      interval: 2s
      timeout: 3s
      retries: 20

  clickhouse:
    image: clickhouse/clickhouse-server:24-alpine
    ports: ["8123:8123", "9000:9000"]
    ulimits:
      nofile: {soft: 262144, hard: 262144}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8123/ping"]
      interval: 3s
      timeout: 3s
      retries: 20

  orchestrator:
    <<: *app
    environment: {SERVICE: orchestrator}
    ports: ["8000:8000"]
    depends_on:
      postgres: {condition: service_healthy}
      clickhouse: {condition: service_healthy}

  producer-agent:
    <<: *app
    environment: {SERVICE: producer-agent}
    ports: ["8001:8001"]

  scout-agent:
    <<: *app
    environment: {SERVICE: scout-agent}
    ports: ["8002:8002"]

  negotiation-agent:
    <<: *app
    environment: {SERVICE: negotiation-agent}
    ports: ["8003:8003"]

  compliance-agent:
    <<: *app
    environment: {SERVICE: compliance-agent}
    ports: ["8004:8004"]

  recovery-agent:
    <<: *app
    environment: {SERVICE: recovery-agent}
    ports: ["8005:8005"]

  vendor-mock-1:
    <<: *app
    environment: {SERVICE: vendor-mock, PORT: 9001}
    ports: ["9001:9001"]

  vendor-mock-2:
    <<: *app
    environment: {SERVICE: vendor-mock, PORT: 9002}
    ports: ["9002:9002"]

  vendor-mock-3:
    <<: *app
    environment: {SERVICE: vendor-mock, PORT: 9003}
    ports: ["9003:9003"]
```

Note: `recovery-agent` is listed now so the topology is complete, but its module does not exist
until Task 19. Until then that one container will restart-loop — expected, and it does not block
the happy path. Comment it out if the noise is distracting.

- [ ] **Step 2: Bring the stack up**

```bash
cp .env.example .env
# put your real GEMINI_API_KEY and the model id from Task 1 into .env
docker compose up -d --build
docker compose ps
```

Expected: postgres and clickhouse healthy; orchestrator, four agents, and three vendor mocks running.

- [ ] **Step 3: Seed and verify MCP tool contracts**

```bash
docker compose exec orchestrator python -m seeds.seed
curl -s localhost:8000/healthz | python -m json.tool
```

Expected: `healthz` lists each agent with its real tool names — `producer` shows
`["decompose_brief"]`, `scout` shows `["find_vendors"]`, `negotiation` shows `["negotiate"]`,
`compliance` shows `["check_compliance", "request_approval"]`. That output is a judge-facing
artifact; screenshot it.

- [ ] **Step 4: Write the integration test**

```python
# tests/test_integration_happy_path.py
"""Criterion 1. Requires `docker compose up -d` and a seeded database."""
import asyncio

import httpx
import pytest

pytestmark = pytest.mark.integration

BASE = "http://localhost:8000"
BRIEF = {
    "brief_text": (
        "Three-day commercial shoot in Lisbon in early September. We need two camera "
        "packages, a small crew including aerial drone coverage over the waterfront, "
        "a riverside location, and transport for the team."
    ),
    "budget_cap": "150000.00",
    "location": "Lisbon",
    "start_date": "2026-09-01",
    "end_date": "2026-09-03",
}


async def _wait_for_terminal(client, production_id, headers, timeout=170):
    waited = 0.0
    while waited < timeout:
        body = (await client.get(f"/productions/{production_id}/status", headers=headers)).json()
        if body["status"] in {"booked", "awaiting_approval", "failed"}:
            return body
        await asyncio.sleep(1.0)
        waited += 1.0
    raise AssertionError(f"production did not settle within {timeout}s")


async def test_full_happy_path():
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        created = await client.post("/productions", headers=headers, json=BRIEF)
        assert created.status_code == 202, "must return immediately, not block on the pipeline"
        production_id = created.json()["production_id"]

        final = await _wait_for_terminal(client, production_id, headers)
        assert final["status"] in {"booked", "awaiting_approval"}, final

        # all ten steps reported done, in order
        done = [s["step"] for s in final["steps"] if s["status"] == "done"]
        assert sorted(set(done)) == list(range(1, 11)), f"missing steps: {sorted(set(done))}"

        # every agent actually participated
        trace = (await client.get(f"/productions/{production_id}/trace", headers=headers)).json()
        assert {"producer-agent", "scout-agent", "negotiation-agent",
                "compliance-agent"} <= set(trace["actors"]), trace["actors"]

        # negotiation was a real multi-round exchange, not a single number
        rounds = [e for e in trace["trace"] if e["action"] == "negotiation_round"]
        assert len(rounds) >= 2, "negotiation must show more than one round"
        assert any(r["payload"]["decision"] == "counter" for r in rounds), \
            "at least one vendor must have countered rather than instantly accepting"

        # every figure shown came from the DB
        assert final["total_cost"] is not None
        assert float(final["total_cost"]) > 0


async def test_sse_streams_incremental_progress():
    async with httpx.AsyncClient(base_url=BASE, timeout=180) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]

        seen = []
        async with client.stream("GET", f"/productions/{production_id}/events") as response:
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    seen.append(line)
                if line.startswith("event: end"):
                    break

        assert len(seen) >= 10, "the stream must show incremental progress, not one final blob"
```

- [ ] **Step 5: Run the integration test**

```bash
uv run pytest tests/test_integration_happy_path.py -v -m integration
```

Expected: PASS, both tests. Note the wall-clock time reported by pytest.

- [ ] **Step 6: Gate checks — all four must pass before continuing**

```bash
# 1. every unit and service test still green
uv run pytest -v

# 2. the happy path settles in well under 3 minutes
time uv run pytest tests/test_integration_happy_path.py::test_full_happy_path -m integration

# 3. the trace shows all four agents and multiple negotiation rounds
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:8000/productions/$PID/trace | python -m json.tool | head -60

# 4. a booking or a pending approval exists in Postgres
docker compose exec postgres psql -U cinex -d cinex \
  -c "select status, count(*) from bookings group by status;" \
  -c "select producer_decision, count(*) from approvals group by producer_decision;"
```

If the wall clock is above ~90 seconds, the likely cause is negotiation LLM latency. Reduce
`NEGOTIATION_MAX_ROUNDS` to 2 in `.env.demo` and re-measure before optimising anything else.

- [ ] **Step 7: Write the demo script**

```bash
# scripts/demo_happy_path.sh
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}

TOKEN=$(curl -s -X POST "$BASE/auth/token" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
PID=$(curl -s -X POST "$BASE/productions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @scripts/brief.json | python -c "import sys,json; print(json.load(sys.stdin)['production_id'])")

echo "production: $PID"
echo "$PID" > .last_production_id
curl -N "$BASE/productions/$PID/events"
```

Save the brief from the integration test to `scripts/brief.json`. Writing the id to
`.last_production_id` is what lets the recovery demo in Task 20 run without you copying a UUID on
stage. Add `.last_production_id` to `.gitignore`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml scripts tests/test_integration_happy_path.py .gitignore
git commit -m "feat: compose topology and end-to-end happy path integration test"
```

**Criterion 1 is now met.** Proceed to recovery.

---

## Task 19: Emergency Recovery Agent

Seven steps, each appending to `recovery_events.timeline` **as it completes**, so a mid-run failure
still leaves a readable artifact. Steps 1 and 2 are MCP calls to the same Scout and Negotiation
agents the happy path uses — no procurement logic is duplicated here.

**Files:**
- Create: `services/recovery_agent/__init__.py`, `services/recovery_agent/schedule.py`, `services/recovery_agent/main.py`
- Test: `tests/test_schedule.py`, `tests/test_recovery_agent.py`

**Interfaces:**
- Consumes: `get_agents`, `evaluate_approval`, `check_insurance`, `check_permit`, models.
- Produces:
  - `services.recovery_agent.schedule.find_collisions(blocked: list[str], start: date, end: date) -> list[str]`
  - `services.recovery_agent.main._recover(production_id, booking_id, trigger) -> dict` with keys `recovery_event_id`, `timeline`, `outcome`
  - MCP tool `recover`; `app`

- [ ] **Step 1: Write the failing schedule test**

```python
# tests/test_schedule.py
from datetime import date

from services.recovery_agent.schedule import find_collisions


def test_no_collision_when_calendar_is_clear():
    assert find_collisions([], date(2026, 9, 1), date(2026, 9, 3)) == []


def test_reports_each_blocked_day_inside_the_window():
    collisions = find_collisions(
        ["2026-09-02", "2026-09-09"], date(2026, 9, 1), date(2026, 9, 3)
    )
    assert collisions == ["2026-09-02"]


def test_window_is_inclusive_of_both_ends():
    collisions = find_collisions(
        ["2026-09-01", "2026-09-03"], date(2026, 9, 1), date(2026, 9, 3)
    )
    assert collisions == ["2026-09-01", "2026-09-03"]


def test_malformed_dates_are_ignored_rather_than_crashing_a_recovery():
    assert find_collisions(["not-a-date"], date(2026, 9, 1), date(2026, 9, 3)) == []
```

- [ ] **Step 2: Run to confirm failure, then implement**

Run: `uv run pytest tests/test_schedule.py -v` → FAIL, `ModuleNotFoundError`

```python
# services/recovery_agent/schedule.py
"""Schedule collision detection. Pure, so the number shown to the producer is arguable."""
from datetime import date, timedelta


def find_collisions(blocked: list[str], start: date, end: date) -> list[str]:
    wanted = {start + timedelta(days=offset) for offset in range((end - start).days + 1)}
    hits = []
    for raw in blocked:
        try:
            parsed = date.fromisoformat(raw)
        except (ValueError, TypeError):
            continue
        if parsed in wanted:
            hits.append(parsed.isoformat())
    return sorted(hits)
```

Run: `uv run pytest tests/test_schedule.py -v` → PASS

- [ ] **Step 3: Write the failing recovery test**

```python
# tests/test_recovery_agent.py
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import Booking, Offer, RecoveryEvent, Requirement, Vendor

pytestmark = pytest.mark.integration

STEP_NAMES = [
    "find_replacement", "negotiate_replacement", "recalculate_cost",
    "check_schedule", "update_records", "present_diff", "approval_gate",
]


@pytest.fixture
async def booked(session, production):
    r = Requirement(production_id=production.id, category="camera", spec={}, quantity=1, priority=1)
    session.add(r)
    await session.flush()

    failed = Vendor(id=uuid.UUID(int=300, version=4), name="Dropout Cams", category="camera",
                    rating=Decimal("4.5"), base_price=Decimal("2000.00"),
                    availability_calendar={"blocked": []}, contact_meta={"endpoint": "http://v1"})
    replacement = Vendor(id=uuid.UUID(int=301, version=4), name="Backup Cams", category="camera",
                         rating=Decimal("4.1"), base_price=Decimal("2200.00"),
                         availability_calendar={"blocked": ["2026-09-02"]},
                         contact_meta={"endpoint": "http://v2"})
    session.add_all([failed, replacement])
    await session.flush()

    offer = Offer(requirement_id=r.id, vendor_id=failed.id, price=Decimal("1900.00"),
                  terms={}, status="accepted", round=2, is_winner=True)
    session.add(offer)
    await session.flush()
    booking = Booking(production_id=production.id, offer_id=offer.id,
                      final_price=Decimal("1900.00"), status="confirmed")
    session.add(booking)
    production.total_cost = Decimal("1900.00")
    production.status = "booked"
    await session.commit()
    await session.refresh(booking)
    return production, booking, r, failed, replacement


@pytest.fixture
def replacement_agents(monkeypatch, booked):
    from services.recovery_agent import main
    _, _, requirement, failed, replacement = booked
    state = {}

    async def fake_call(agent, tool, args):
        if tool == "find_vendors":
            assert str(failed.id) in args["exclude_vendor_ids"], \
                "recovery must exclude the vendor that dropped out"
            async with main.session_scope() as s:
                o = Offer(requirement_id=uuid.UUID(args["requirement_id"]),
                          vendor_id=replacement.id, price=Decimal("2530.00"),
                          terms={}, status="pending", round=0)
                s.add(o)
                await s.flush()
                state["offer_id"] = str(o.id)
            return {"offers": [{"offer_id": state["offer_id"], "vendor_id": str(replacement.id),
                                "price": "2530.00", "terms": {}, "rank": 1}]}
        if tool == "negotiate":
            async with main.session_scope() as s:
                o = (await s.execute(
                    select(Offer).where(Offer.id == uuid.UUID(state["offer_id"]))
                )).scalar_one()
                o.price = Decimal("2300.00")
                o.status, o.is_winner = "accepted", True
            return {"winning_offer_id": state["offer_id"], "final_price": "2300.00", "rounds": []}
        if tool == "request_approval":
            return {"approval_id": str(uuid.uuid4()), "status": "pending"}
        raise AssertionError(f"unexpected tool {tool}")

    agents = AsyncMock()
    agents.call = AsyncMock(side_effect=fake_call)
    monkeypatch.setattr(main, "get_agents", lambda: agents)
    return agents


async def test_timeline_records_all_seven_steps_in_order(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    assert [entry["step"] for entry in out["timeline"]] == list(range(1, 8))
    assert [entry["name"] for entry in out["timeline"]] == STEP_NAMES
    assert all(entry["ts"] for entry in out["timeline"]), "every step carries its own timestamp"


async def test_old_booking_superseded_and_new_one_created(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    await session.refresh(booking)
    assert booking.status == "superseded"
    fresh = (await session.execute(
        select(Booking).where(Booking.production_id == production.id,
                              Booking.status == "confirmed")
    )).scalars().all()
    assert len(fresh) == 1
    assert fresh[0].final_price == Decimal("2300.00")


async def test_cost_delta_is_computed_from_db_state(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    recalc = next(e for e in out["timeline"] if e["name"] == "recalculate_cost")
    assert recalc["detail"]["old_total"] == "1900.00"
    assert recalc["detail"]["new_total"] == "2300.00"
    assert recalc["detail"]["delta"] == "400.00"


async def test_schedule_collision_is_reported(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    schedule = next(e for e in out["timeline"] if e["name"] == "check_schedule")
    assert schedule["detail"]["collisions"] == ["2026-09-02"]


async def test_diff_shows_old_versus_new(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    diff = next(e for e in out["timeline"] if e["name"] == "present_diff")
    assert diff["detail"]["old"]["vendor_name"] == "Dropout Cams"
    assert diff["detail"]["new"]["vendor_name"] == "Backup Cams"
    assert diff["detail"]["old"]["price"] == "1900.00"
    assert diff["detail"]["new"]["price"] == "2300.00"


async def test_over_threshold_delta_raises_approval(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    out = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    gate = next(e for e in out["timeline"] if e["name"] == "approval_gate")
    assert gate["detail"]["approval_required"] is True, \
        "1900 -> 2300 is a 21% delta, well over the 10% threshold"
    assert out["outcome"] == "awaiting_approval"

    event = (await session.execute(
        select(RecoveryEvent).where(RecoveryEvent.production_id == production.id)
    )).scalar_one()
    assert event.status == "awaiting_approval"


async def test_re_triggering_returns_the_existing_event(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    first = await _recover(str(production.id), str(booking.id), "vendor_unavailable")
    second = await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    assert second["recovery_event_id"] == first["recovery_event_id"]
    assert second["outcome"] == "already_in_progress"
    events = (await session.execute(
        select(RecoveryEvent).where(RecoveryEvent.production_id == production.id)
    )).scalars().all()
    assert len(events) == 1, "a fumbled re-trigger must not fork state"


async def test_the_brief_is_never_resubmitted(session, booked, replacement_agents):
    from services.recovery_agent.main import _recover
    production, booking, *_ = booked

    await _recover(str(production.id), str(booking.id), "vendor_unavailable")

    for call in replacement_agents.call.await_args_list:
        _, tool, args = call.args
        assert tool != "decompose_brief"
        assert "brief_text" not in args and "text" not in args
```

- [ ] **Step 4: Run to confirm failure**

Run: `uv run pytest tests/test_recovery_agent.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'services.recovery_agent.main'`

- [ ] **Step 5: Implement**

```python
# services/recovery_agent/main.py
"""The 7-step emergency recovery machine.

Steps 1 and 2 re-invoke Scout and Negotiation over MCP - the same agents the
happy path uses. Nothing here re-reads the original brief; the requirement rows
already exist, which is the whole point of the demo beat.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.config import get_settings
from cinex.db.models import Booking, Offer, Production, RecoveryEvent, Requirement, Vendor
from cinex.db.session import session_scope
from cinex.logging import get_logger
from cinex.mcp_client import get_agents
from services.compliance_agent.rules import check_insurance, check_permit, evaluate_approval
from services.recovery_agent.schedule import find_collisions

log = get_logger("recovery-agent")
mcp = FastMCP("recovery-agent")
AGENT = "recovery-agent"
ACTIVE = ("pending", "in_progress", "awaiting_approval")

STEP_NAMES = {
    1: "find_replacement",
    2: "negotiate_replacement",
    3: "recalculate_cost",
    4: "check_schedule",
    5: "update_records",
    6: "present_diff",
    7: "approval_gate",
}


async def _append(session, event: RecoveryEvent, step: int, detail: dict) -> None:
    """Append to the timeline as each step completes, so a crash still leaves an artifact."""
    entry = {
        "step": step,
        "name": STEP_NAMES[step],
        "ts": datetime.now(timezone.utc).isoformat(),
        "detail": detail,
    }
    event.timeline = [*event.timeline, entry]
    await write_audit(
        session, actor=AGENT, action=f"recovery.{STEP_NAMES[step]}",
        entity_type="recovery_event", entity_id=event.id,
        payload={"production_id": str(event.production_id), **entry},
    )


async def _recover(production_id: str, booking_id: str, trigger: str) -> dict:
    pid, bid = uuid.UUID(production_id), uuid.UUID(booking_id)
    agents = get_agents()
    settings = get_settings()

    # idempotency: never fork state on a fumbled re-trigger
    async with session_scope() as session:
        existing = (await session.execute(
            select(RecoveryEvent).where(
                RecoveryEvent.production_id == pid, RecoveryEvent.status.in_(ACTIVE)
            )
        )).scalars().first()
        if existing is not None:
            log.info("recovery_already_active", extra={"production_id": production_id})
            return {"recovery_event_id": str(existing.id), "timeline": existing.timeline,
                    "outcome": "already_in_progress"}

        event = RecoveryEvent(production_id=pid, trigger=trigger,
                              affected_booking_id=bid, status="in_progress", timeline=[])
        session.add(event)
        await session.flush()
        event_id = event.id

    async with session_scope() as session:
        event = (await session.execute(
            select(RecoveryEvent).where(RecoveryEvent.id == event_id)
        )).scalar_one()
        production = (await session.execute(
            select(Production).where(Production.id == pid)
        )).scalar_one()
        old_booking = (await session.execute(
            select(Booking).where(Booking.id == bid)
        )).scalar_one()
        old_offer = (await session.execute(
            select(Offer).where(Offer.id == old_booking.offer_id)
        )).scalar_one()
        old_vendor = (await session.execute(
            select(Vendor).where(Vendor.id == old_offer.vendor_id)
        )).scalar_one()
        requirement = (await session.execute(
            select(Requirement).where(Requirement.id == old_offer.requirement_id)
        )).scalar_one()

        old_total = production.total_cost or Decimal("0")
        production.status = "recovering"

        # 1 - find an equivalent vendor, excluding the one that dropped out
        scouted = await agents.call("scout", "find_vendors", {
            "requirement_id": str(requirement.id),
            "exclude_vendor_ids": [str(old_vendor.id)],
        })
        candidates = scouted["offers"]
        await _append(session, event, 1, {
            "excluded_vendor": str(old_vendor.id),
            "excluded_vendor_name": old_vendor.name,
            "candidates": len(candidates),
            "candidate_names": [c.get("vendor_name") for c in candidates],
        })

        if not candidates:
            event.status = "failed"
            await _append(session, event, 2, {"error": "no replacement vendors available"})
            return {"recovery_event_id": str(event_id), "timeline": event.timeline,
                    "outcome": "failed"}

        # 2 - negotiate with the replacement
        negotiated = await agents.call("negotiation", "negotiate", {
            "requirement_id": str(requirement.id),
            "offer_ids": [c["offer_id"] for c in candidates],
            "max_rounds": settings.negotiation_max_rounds,
        })
        new_offer = (await session.execute(
            select(Offer).where(Offer.id == uuid.UUID(negotiated["winning_offer_id"]))
        )).scalar_one()
        new_vendor = (await session.execute(
            select(Vendor).where(Vendor.id == new_offer.vendor_id)
        )).scalar_one()
        await _append(session, event, 2, {
            "vendor_name": new_vendor.name,
            "final_price": str(new_offer.price),
            "rounds": len(negotiated.get("rounds", [])),
        })

        # 3 - recalculate the total from live DB state
        old_booking.status = "superseded"
        old_offer.is_winner = False
        new_booking = Booking(production_id=pid, offer_id=new_offer.id,
                              final_price=new_offer.price, status="confirmed")
        session.add(new_booking)
        await session.flush()

        confirmed = (await session.execute(
            select(Booking.final_price).where(Booking.production_id == pid,
                                              Booking.status == "confirmed")
        )).scalars().all()
        new_total = sum(confirmed, Decimal("0"))
        production.total_cost = new_total
        delta = new_total - old_total
        await _append(session, event, 3, {
            "old_total": str(old_total), "new_total": str(new_total), "delta": str(delta),
        })

        # 4 - schedule impact
        collisions = find_collisions(
            new_vendor.availability_calendar.get("blocked", []),
            production.start_date, production.end_date,
        )
        await _append(session, event, 4, {
            "collisions": collisions,
            "window": [production.start_date.isoformat(), production.end_date.isoformat()],
            "impact": "none" if not collisions else f"{len(collisions)} blocked day(s)",
        })

        # 5 - insurance and logistics records against the new vendor
        permit = check_permit(production.location, production.start_date,
                              production.end_date, {requirement.category})
        insurance = check_insurance(new_total, Decimal(str(settings.insurance_rider_threshold)))
        from cinex.db.models import ComplianceCheck
        for result in (permit, insurance):
            session.add(ComplianceCheck(production_id=pid, booking_id=new_booking.id,
                                        check_type=result.check_type, status=result.status,
                                        evidence=result.evidence))
        await _append(session, event, 5, {
            "permit": permit.status, "insurance": insurance.status,
            "rebound_to_booking": str(new_booking.id),
        })

        # 6 - the producer-facing diff
        diff = {
            "old": {"booking_id": str(old_booking.id), "vendor_name": old_vendor.name,
                    "price": str(old_offer.price), "status": "superseded"},
            "new": {"booking_id": str(new_booking.id), "vendor_name": new_vendor.name,
                    "price": str(new_offer.price), "status": "confirmed"},
            "delta": str(delta),
            "schedule_collisions": collisions,
        }
        await _append(session, event, 6, diff)

        # 7 - approval gate, same function the happy path uses, recovery baseline
        decision = evaluate_approval(
            total_cost=new_total,
            budget_cap=production.budget_cap,
            baseline=old_total,
            check_statuses=[permit.status, insurance.status],
            threshold_pct=settings.approval_threshold_pct,
        )
        gate = {
            "approval_required": decision.required,
            "reasons": decision.reasons,
            "delta_amount": str(decision.delta_amount),
            "delta_pct": round(decision.delta_pct, 2),
            "threshold_pct": settings.approval_threshold_pct,
        }

        if decision.required:
            approval = await agents.call("compliance", "request_approval", {
                "production_id": str(pid),
                "reason": f"recovery:{','.join(decision.reasons)}",
                "delta_amount": str(decision.delta_amount),
                "threshold_breached": decision.threshold_breached,
            })
            gate["approval_id"] = approval["approval_id"]
            event.status = "awaiting_approval"
            production.status = "awaiting_approval"
            outcome = "awaiting_approval"
        else:
            event.status = "resolved"
            production.status = "booked"
            outcome = "resolved"

        await _append(session, event, 7, gate)
        event.resolution_booking_id = new_booking.id
        timeline = event.timeline

    log.info("recovery_complete", extra={"production_id": production_id, "outcome": outcome})
    return {"recovery_event_id": str(event_id), "timeline": timeline, "outcome": outcome}


@mcp.tool
async def recover(production_id: str, booking_id: str, trigger: str = "vendor_unavailable") -> dict:
    """Run the 7-step recovery for a booking whose vendor has dropped out."""
    return await _recover(production_id, booking_id, trigger)


mcp_app = mcp.http_app(path="/mcp")
app = FastAPI(title="Recovery Agent", lifespan=mcp_app.lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "agent": AGENT}


app.mount("/", mcp_app)
```

- [ ] **Step 6: Run the tests**

Run: `uv run pytest tests/test_recovery_agent.py tests/test_schedule.py -v -m integration`
Expected: PASS, 12 tests

- [ ] **Step 7: Commit**

```bash
git add services/recovery_agent tests/test_recovery_agent.py tests/test_schedule.py
git commit -m "feat: 7-step emergency recovery agent with idempotent event tracking"
```

---

## Task 20: Recovery endpoint and the Criterion 2 gate

**Files:**
- Modify: `services/orchestrator/main.py` — add the recovery endpoint
- Create: `scripts/demo_recovery.sh`
- Test: `tests/test_integration_recovery.py`

**Interfaces:**
- Consumes: `get_agents`, `RecoveryEvent`, `Booking`.
- Produces: `POST /productions/{id}/recovery` accepting `{booking_id?, trigger?}` and returning `{recovery_event_id, timeline, outcome}`.

`booking_id` is optional. If omitted the orchestrator picks the production's most expensive
confirmed booking — one less UUID to paste on stage.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_integration_recovery.py
"""Criterion 2. Requires `docker compose up -d` and a seeded database."""
import asyncio

import httpx
import pytest

pytestmark = pytest.mark.integration

BASE = "http://localhost:8000"
BRIEF = {
    "brief_text": (
        "Three-day commercial shoot in Lisbon in early September. We need two camera "
        "packages, a small crew including aerial drone coverage over the waterfront, "
        "a riverside location, and transport for the team."
    ),
    "budget_cap": "150000.00",
    "location": "Lisbon",
    "start_date": "2026-09-01",
    "end_date": "2026-09-03",
}
STEP_NAMES = [
    "find_replacement", "negotiate_replacement", "recalculate_cost",
    "check_schedule", "update_records", "present_diff", "approval_gate",
]


async def _settle(client, production_id, headers, timeout=170):
    waited = 0.0
    while waited < timeout:
        body = (await client.get(f"/productions/{production_id}/status", headers=headers)).json()
        if body["status"] in {"booked", "awaiting_approval", "failed"}:
            return body
        await asyncio.sleep(1.0)
        waited += 1.0
    raise AssertionError("production did not settle")


async def test_recovery_produces_a_seven_step_timeline():
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)

        # approve if the happy path parked, so there is a confirmed booking to break
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            before = await _settle(client, production_id, headers)
        assert before["status"] == "booked", before

        recovery = await client.post(f"/productions/{production_id}/recovery",
                                     headers=headers, json={"trigger": "vendor_unavailable"})
        assert recovery.status_code == 200, recovery.text
        body = recovery.json()

        assert [e["step"] for e in body["timeline"]] == list(range(1, 8))
        assert [e["name"] for e in body["timeline"]] == STEP_NAMES
        assert body["outcome"] in {"resolved", "awaiting_approval"}

        # the cost delta came from real rows
        recalc = next(e for e in body["timeline"] if e["name"] == "recalculate_cost")
        assert recalc["detail"]["old_total"] != recalc["detail"]["new_total"]


async def test_recovery_never_asks_for_the_brief_again():
    """The claim the demo rests on: no endpoint required the original brief."""
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            await _settle(client, production_id, headers)

        # note the empty body - nothing but the production id in the URL
        response = await client.post(f"/productions/{production_id}/recovery",
                                     headers=headers, json={})
        assert response.status_code == 200
        assert len(response.json()["timeline"]) == 7


async def test_re_triggering_recovery_is_idempotent():
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:
        token = (await client.post("/auth/token")).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        production_id = (await client.post(
            "/productions", headers=headers, json=BRIEF
        )).json()["production_id"]
        before = await _settle(client, production_id, headers)
        if before["status"] == "awaiting_approval":
            await client.post(f"/approvals/{before['pending_approval_id']}/decide",
                              headers=headers, json={"decision": "approved"})
            await _settle(client, production_id, headers)

        first = (await client.post(f"/productions/{production_id}/recovery",
                                   headers=headers, json={})).json()
        second = (await client.post(f"/productions/{production_id}/recovery",
                                    headers=headers, json={})).json()

        if first["outcome"] == "awaiting_approval":
            assert second["recovery_event_id"] == first["recovery_event_id"]
            assert second["outcome"] == "already_in_progress"
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_integration_recovery.py -v -m integration`
Expected: FAIL, 404 or 405 on the recovery endpoint

- [ ] **Step 3: Add the endpoint to `services/orchestrator/main.py`**

Add this import alongside the existing model imports:

```python
from cinex.db.models import Booking, RecoveryEvent
```

Add the request model next to `ApprovalDecisionRequest`:

```python
class RecoveryRequest(BaseModel):
    booking_id: uuid.UUID | None = None
    trigger: str = "vendor_unavailable"
```

Add the endpoint:

```python
@app.post("/productions/{production_id}/recovery")
async def recovery(
    production_id: uuid.UUID,
    body: RecoveryRequest,
    _: Producer = Depends(require_producer),
) -> dict:
    """Trigger the 7-step recovery. booking_id is optional - omitted, we take the
    most expensive confirmed booking, so the live demo needs one less UUID."""
    async with session_scope() as session:
        active = (await session.execute(
            select(RecoveryEvent).where(
                RecoveryEvent.production_id == production_id,
                RecoveryEvent.status.in_(("pending", "in_progress", "awaiting_approval")),
            )
        )).scalars().first()
        if active is not None:
            return {"recovery_event_id": str(active.id), "timeline": active.timeline,
                    "outcome": "already_in_progress"}

        booking_id = body.booking_id
        if booking_id is None:
            booking = (await session.execute(
                select(Booking)
                .where(Booking.production_id == production_id, Booking.status == "confirmed")
                .order_by(Booking.final_price.desc())
            )).scalars().first()
            if booking is None:
                raise HTTPException(status_code=409,
                                    detail="no confirmed booking to recover")
            booking_id = booking.id

        await write_audit(session, actor="producer", action="trigger_recovery",
                          entity_type="production", entity_id=production_id,
                          payload={"booking_id": str(booking_id), "trigger": body.trigger})

    return await get_agents().call("recovery", "recover", {
        "production_id": str(production_id),
        "booking_id": str(booking_id),
        "trigger": body.trigger,
    })
```

- [ ] **Step 4: Rebuild and rerun**

```bash
docker compose up -d --build orchestrator recovery-agent
uv run pytest tests/test_integration_recovery.py -v -m integration
```

Expected: PASS, 3 tests

- [ ] **Step 5: Write the demo script**

```bash
# scripts/demo_recovery.sh
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}
PID=${1:-$(cat .last_production_id)}

TOKEN=$(curl -s -X POST "$BASE/auth/token" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# take the booked vendor genuinely offline so recovery reacts to a real 503
VENDOR=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/productions/$PID/status" \
  | python -c "import sys,json; print(json.load(sys.stdin)['steps'][-1]['detail'])")
echo "state before: $VENDOR"

curl -s -X POST "$BASE/productions/$PID/recovery" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"trigger":"vendor_unavailable"}' | python -m json.tool
```

- [ ] **Step 6: Gate checks — Criterion 2 and 3**

```bash
# full suite green
uv run pytest -v

# the 7-step timeline persisted, with per-step timestamps
docker compose exec postgres psql -U cinex -d cinex -c \
  "select jsonb_array_length(timeline) as steps, status, trigger from recovery_events;"

# criterion 3: every producer-facing number traces to a row
docker compose exec postgres psql -U cinex -d cinex -c \
  "select b.status, b.final_price, v.name from bookings b
     join offers o on o.id = b.offer_id join vendors v on v.id = o.vendor_id;"
```

Expected: `steps` is 7 for each completed recovery. The booking prices in the second query match
the `old_total` / `new_total` in the timeline exactly.

- [ ] **Step 7: Commit**

```bash
git add services/orchestrator/main.py scripts/demo_recovery.sh tests/test_integration_recovery.py
git commit -m "feat: recovery endpoint with optional booking selection and idempotent re-trigger"
```

**Criteria 2 and 3 are now met.**

---

## Task 21: ClickHouse write-through and the market anchor

Two queries that are load-bearing, not decoration. Query 1 becomes the Negotiation Agent's opening
anchor, replacing the Postgres median placeholder from Task 13.

**Files:**
- Create: `cinex/clickhouse.py`
- Modify: `services/negotiation_agent/main.py` — replace the local `market_anchor`
- Modify: `services/scout_agent/main.py` — emit price events
- Test: `tests/test_clickhouse.py`

**Interfaces:**
- Consumes: `cinex.config.get_settings`.
- Produces: `init_clickhouse() -> None`, `record_offer_event(category, vendor_id, price, kind) -> None` (fire-and-forget), `median_price(category) -> Decimal`, `cost_delta_history(production_id) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_clickhouse.py
import uuid
from decimal import Decimal

import pytest

from cinex.clickhouse import (
    cost_delta_history, init_clickhouse, median_price, record_offer_event,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def schema():
    await init_clickhouse()


async def test_median_price_of_recorded_offers():
    category = f"probe-{uuid.uuid4().hex[:8]}"
    for price in ("100.00", "200.00", "300.00"):
        await record_offer_event(category, uuid.uuid4(), Decimal(price), "quote")
    assert await median_price(category) == Decimal("200.00")


async def test_median_of_an_unknown_category_is_zero_not_an_error():
    assert await median_price("nothing-here") == Decimal("0")


async def test_a_clickhouse_outage_never_breaks_the_caller(monkeypatch):
    import cinex.clickhouse as ch

    def explode(*_args, **_kwargs):
        raise ConnectionError("clickhouse is down")

    monkeypatch.setattr(ch, "_client", explode)
    await record_offer_event("camera", uuid.uuid4(), Decimal("1"), "quote")  # must not raise


async def test_cost_delta_history_returns_recorded_totals():
    production_id = uuid.uuid4()
    await record_offer_event("camera", uuid.uuid4(), Decimal("1900.00"), "booking",
                             production_id=production_id)
    await record_offer_event("camera", uuid.uuid4(), Decimal("2300.00"), "recovery_booking",
                             production_id=production_id)
    history = await cost_delta_history(production_id)
    assert [h["kind"] for h in history] == ["booking", "recovery_booking"]
```

- [ ] **Step 2: Run to confirm failure**

Run: `uv run pytest tests/test_clickhouse.py -v -m integration`
Expected: FAIL, `ModuleNotFoundError: No module named 'cinex.clickhouse'`

- [ ] **Step 3: Implement**

```python
# cinex/clickhouse.py
"""Analytics write-through. Never the system of record, and never on the
critical path - every write here is fire-and-forget."""
import asyncio
import uuid
from decimal import Decimal
from functools import lru_cache

import clickhouse_connect

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.clickhouse")

DDL = """
CREATE TABLE IF NOT EXISTS offer_events (
    ts            DateTime DEFAULT now(),
    category      String,
    vendor_id     String,
    production_id String,
    price         Decimal(12, 2),
    kind          String
) ENGINE = MergeTree()
ORDER BY (category, ts)
"""


@lru_cache
def _client():
    url = get_settings().clickhouse_url
    host = url.split("//", 1)[-1].split(":")[0]
    return clickhouse_connect.get_client(host=host, port=8123)


async def init_clickhouse() -> None:
    await asyncio.to_thread(lambda: _client().command(DDL))


async def record_offer_event(
    category: str,
    vendor_id: uuid.UUID,
    price: Decimal,
    kind: str,
    production_id: uuid.UUID | None = None,
) -> None:
    """Fire and forget. A ClickHouse outage must never fail a booking."""
    def _insert() -> None:
        _client().insert(
            "offer_events",
            [[category, str(vendor_id), str(production_id or ""), price, kind]],
            column_names=["category", "vendor_id", "production_id", "price", "kind"],
        )

    try:
        await asyncio.to_thread(_insert)
    except Exception as exc:  # noqa: BLE001 - analytics must never break the caller
        log.warning("clickhouse_write_failed", extra={"error": str(exc), "kind": kind})


async def median_price(category: str) -> Decimal:
    """Query 1. The Negotiation Agent's opening anchor."""
    def _query() -> Decimal:
        result = _client().query(
            "SELECT quantileExact(0.5)(price) FROM offer_events WHERE category = {c:String}",
            parameters={"c": category},
        )
        if not result.result_rows or result.result_rows[0][0] is None:
            return Decimal("0")
        return Decimal(str(result.result_rows[0][0])).quantize(Decimal("0.01"))

    try:
        return await asyncio.to_thread(_query)
    except Exception as exc:  # noqa: BLE001
        log.warning("clickhouse_query_failed", extra={"error": str(exc)})
        return Decimal("0")


async def cost_delta_history(production_id: uuid.UUID) -> list[dict]:
    """Query 2. Feeds the recovery diff."""
    def _query() -> list[dict]:
        result = _client().query(
            "SELECT ts, kind, price FROM offer_events "
            "WHERE production_id = {p:String} ORDER BY ts",
            parameters={"p": str(production_id)},
        )
        return [
            {"ts": str(row[0]), "kind": row[1], "price": str(row[2])}
            for row in result.result_rows
        ]

    try:
        return await asyncio.to_thread(_query)
    except Exception as exc:  # noqa: BLE001
        log.warning("clickhouse_query_failed", extra={"error": str(exc)})
        return []
```

- [ ] **Step 4: Wire the anchor into the Negotiation Agent**

In `services/negotiation_agent/main.py`, delete the local `market_anchor` function and its
`select(Vendor.base_price)` query, then add:

```python
from cinex.clickhouse import median_price


async def market_anchor(category: str) -> Decimal:
    """Query 1 from ClickHouse. Falls back to the Postgres median only if the
    analytics store has no history yet."""
    anchor = await median_price(category)
    if anchor > 0:
        return anchor
    async with session_scope() as session:
        prices = (await session.execute(
            select(Vendor.base_price).where(Vendor.category == category)
        )).scalars().all()
    if not prices:
        return Decimal("0")
    return sorted(prices)[len(prices) // 2]
```

- [ ] **Step 5: Emit price events from the Scout Agent**

In `services/scout_agent/main.py`, inside the `for rank, (vendor, price, terms, available)` loop,
after `await session.flush()`, add:

```python
        await record_offer_event(requirement.category, vendor.id, price, "quote")
```

and the import:

```python
from cinex.clickhouse import record_offer_event
```

- [ ] **Step 6: Initialise the schema on orchestrator startup**

In `services/orchestrator/main.py`, extend the startup hook:

```python
@app.on_event("startup")
async def startup() -> None:
    await init_db()
    try:
        await init_clickhouse()
    except Exception as exc:  # noqa: BLE001 - analytics is optional to boot
        log.warning("clickhouse_init_failed", extra={"error": str(exc)})
```

with `from cinex.clickhouse import init_clickhouse`.

- [ ] **Step 7: Run the tests and confirm the anchor is live**

```bash
docker compose up -d --build
uv run pytest tests/test_clickhouse.py -v -m integration
uv run pytest tests/test_integration_happy_path.py -v -m integration

# the anchor should now appear in the negotiation audit payloads with a non-zero value
docker compose exec postgres psql -U cinex -d cinex -c \
  "select payload->>'anchor' from audit_log where action = 'negotiate' limit 5;"
```

Expected: non-zero anchors after the second production run — the first run populates the history
the second one reads.

- [ ] **Step 8: Commit**

```bash
git add cinex/clickhouse.py services/negotiation_agent/main.py services/scout_agent/main.py \
        services/orchestrator/main.py tests/test_clickhouse.py
git commit -m "feat: clickhouse write-through feeding the negotiation market anchor"
```

---

## Task 22: Demo hardening

**Files:**
- Create: `README.md`, `docs/API.md`, `scripts/reset_demo.sh`
- Test: `tests/test_healthz.py`

**Interfaces:**
- Consumes: everything.
- Produces: `docs/API.md` — the written frontend contract promised on day one.

- [ ] **Step 1: Write the health test**

```python
# tests/test_healthz.py
import httpx
import pytest

pytestmark = pytest.mark.integration

SERVICES = {
    "orchestrator": 8000, "producer-agent": 8001, "scout-agent": 8002,
    "negotiation-agent": 8003, "compliance-agent": 8004, "recovery-agent": 8005,
    "vendor-mock-1": 9001, "vendor-mock-2": 9002, "vendor-mock-3": 9003,
}


@pytest.mark.parametrize("name,port", SERVICES.items())
async def test_service_is_healthy(name, port):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"http://localhost:{port}/healthz")
    assert response.status_code == 200, name
    assert response.json()["ok"] is True


async def test_orchestrator_reports_every_agents_tools():
    async with httpx.AsyncClient(timeout=30) as client:
        agents = (await client.get("http://localhost:8000/healthz")).json()["agents"]
    assert agents["producer"] == ["decompose_brief"]
    assert agents["scout"] == ["find_vendors"]
    assert agents["negotiation"] == ["negotiate"]
    assert sorted(agents["compliance"]) == ["check_compliance", "request_approval"]
    assert agents["recovery"] == ["recover"]
```

- [ ] **Step 2: Run it**

Run: `uv run pytest tests/test_healthz.py -v -m integration`
Expected: PASS, 10 tests. A failure here means a service is down or an MCP tool is misnamed — fix
before rehearsing.

- [ ] **Step 3: Write `docs/API.md`**

Document every endpoint from spec §7 with a real request and a real response body captured from a
live run — not invented examples. Include the SSE event schema, the `productions.status` enum
values, and the step number-to-name mapping from `STEPS`. Send it to the frontend teammate.

- [ ] **Step 4: Write `scripts/reset_demo.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
docker compose exec -T postgres psql -U cinex -d cinex <<'SQL'
TRUNCATE audit_log, recovery_events, approvals, compliance_checks,
         bookings, offers, requirements, productions CASCADE;
SQL
for port in 9001 9002 9003; do
  for vendor in $(python -c "
import json;print(' '.join(v['id'] for v in json.load(open('seeds/vendors.json'))))"); do
    curl -s -X POST "http://localhost:$port/admin/vendors/$vendor/enable" > /dev/null || true
  done
done
rm -f .last_production_id
echo "demo reset - vendors re-enabled, transactional tables cleared, seeds intact"
```

Note it truncates everything except `vendors`, so a reset between rehearsals does not require
re-seeding.

- [ ] **Step 5: Write `README.md`**

Cover: what the system does in three sentences, the architecture diagram from the spec, how to run
(`cp .env.example .env`, add the Gemini key, `docker compose up -d --build`, `python -m seeds.seed`),
how to run the two demo scripts, and how to run the tests. State plainly that compliance and vendor
data are mock, and link the spec.

- [ ] **Step 6: Rehearse end to end, twice**

```bash
./scripts/reset_demo.sh
time ./scripts/demo_happy_path.sh
./scripts/demo_recovery.sh
```

Record the wall clock of each. If the happy path exceeds 90 seconds, drop
`NEGOTIATION_MAX_ROUNDS` to 2 in `.env.demo` and re-measure. Decide the value now and do not
change it again before the pitch.

- [ ] **Step 7: Full suite and commit**

```bash
uv run pytest -v
git add README.md docs/API.md scripts/reset_demo.sh tests/test_healthz.py
git commit -m "docs: readme, frontend API contract, and demo reset tooling"
```

---

## Self-review notes

Checked against the spec section by section.

**Spec coverage.** Every section maps to at least one task: §2 stack → Tasks 1, 9; §3 topology →
Tasks 1, 18; §4 data model → Task 2; §5.1–5.5 agents → Tasks 11, 12, 13, 14, 15, 19; §6 vendor
mocks → Tasks 5, 6, 7; §7 API → Tasks 17, 20; §8 ten steps → Task 16; §9 non-functionals → Tasks 8,
17, 18, 20, 22; §10 ClickHouse → Task 21; §11 error handling → Tasks 8, 12, 13, 16; §12 testing →
throughout; §13 build order → the task order itself.

**Two spec items worth flagging:**

- Spec §5.2 describes discovery, solicitation, and shortlisting as separate steps 3, 4, and 5, but
  a single `find_vendors` call does all three. Task 16 emits three distinct step events around that
  one call rather than inventing two extra MCP round trips whose only purpose is to look busy. The
  trace stays honest — the `find_vendors` audit entry shows one call.
- Spec §11 says an unfulfilled requirement should force the approval gate. Task 14's
  `evaluate_approval` handles compliance failures and cost breaches but has no
  `unfulfilled_requirement` reason, because Task 13 guarantees a winner whenever any offer exists
  and Task 12 always produces an offer per vendor via the fallback. The gap is real only if a
  category has zero seeded vendors, which Task 7's test forbids. If that assumption changes, add
  the reason to `evaluate_approval` and a step-7 check in Task 16.

**Type consistency.** `evaluate_approval` takes the same five arguments in Tasks 16 and 19.
`find_vendors(requirement_id, exclude_vendor_ids)` is identical in Tasks 12, 19.
`negotiate(requirement_id, offer_ids, max_rounds)` is identical in Tasks 13, 16, 19.
`market_anchor(category) -> Decimal` is defined locally in Task 13 and replaced in Task 21 Step 4
with the same signature. `STEP_NAMES` in Task 19 matches the list asserted in Tasks 19 and 20.

**Known ordering hazard.** Task 18's compose file lists `recovery-agent` before Task 19 creates its
module, so that container restart-loops until Task 19 lands. Called out in Task 18 Step 1.
