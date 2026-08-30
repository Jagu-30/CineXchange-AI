import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from cinex.db.models import AuditLog, Requirement
from cinex.schemas.agents import Decomposition, RequirementDraft, SpecDetail

pytestmark = pytest.mark.integration


@pytest.fixture
def fake_llm(monkeypatch):
    from services.producer_agent import main

    result = Decomposition(requirements=[
        RequirementDraft(category="camera", details=[SpecDetail(key="model", value="Alexa Mini")],
                         quantity=2, priority=1),
        RequirementDraft(category="crew", role="drone operator", requires_certification=True,
                         quantity=1, priority=1),
        RequirementDraft(category="permit", details=[SpecDetail(key="authority", value="Lisbon CML")],
                         quantity=1, priority=2),
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
        RequirementDraft(category="catering", quantity=1, priority=1),
    ]))
    monkeypatch.setattr(main, "get_llm", lambda: llm)

    with pytest.raises(ValueError, match="catering"):
        await main._decompose(
            production_id=str(production.id), text="x", budget_cap="1.00",
            location="Lisbon", start_date="2026-09-01", end_date="2026-09-03",
        )
