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
    ts            DateTime64(6) DEFAULT now64(6),
    category      String,
    vendor_id     String,
    production_id String,
    price         Decimal(12, 2),
    kind          String
) ENGINE = MergeTree()
ORDER BY (category, ts)
"""
# ts is microsecond-precision (DateTime64(6)/now64(6)), not the plain
# second-precision DateTime this started as: two offer_events for the same
# production_id (e.g. a "booking" then a "recovery_booking") written by
# sequential, sub-second calls used to round to the same one-second bucket,
# leaving cost_delta_history's "ORDER BY ts" order non-deterministic between
# ties - exactly the ordering the recovery diff at spec step 6 depends on.


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
