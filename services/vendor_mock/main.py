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
