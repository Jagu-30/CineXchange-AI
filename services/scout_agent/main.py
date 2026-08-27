import asyncio
import uuid
from decimal import Decimal

from fastapi import FastAPI
from fastmcp import FastMCP
from sqlalchemy import select

from cinex.audit import write_audit
from cinex.db.models import Offer, Production, Requirement, Vendor
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
        prod = (await session.execute(
            select(Production).where(Production.id == requirement.production_id)
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
