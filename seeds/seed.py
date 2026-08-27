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
