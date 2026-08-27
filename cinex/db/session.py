import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from cinex.config import get_settings
from cinex.db.models import Base

# A plain @lru_cache on get_engine() would bind the underlying asyncpg connection
# pool to whichever event loop was running the first time it was created. In
# production there is exactly one long-lived loop (uvicorn), so that's invisible.
# But pytest-asyncio gives each test function its own event loop, so a second test
# reusing the cached engine would hand asyncpg a loop it was never opened on and
# every query fails with "Event loop is closed". Cache per-running-loop instead, so
# a new loop transparently gets a fresh engine while a stable loop still reuses one.
_engine: AsyncEngine | None = None
_engine_loop: asyncio.AbstractEventLoop | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _engine_loop, _sessionmaker
    loop = asyncio.get_running_loop()
    if _engine is None or _engine_loop is not loop:
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
        _engine_loop = loop
        _sessionmaker = None
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    engine = get_engine()
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return _sessionmaker


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
