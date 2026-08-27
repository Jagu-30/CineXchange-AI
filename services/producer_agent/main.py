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
