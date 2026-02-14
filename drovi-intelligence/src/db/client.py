"""
PostgreSQL Async Database Client

Uses SQLAlchemy 2.0 with asyncpg for async database operations.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from src.config import get_settings
from src.db.rls import get_rls_context, is_rls_internal
from sqlalchemy import text

logger = structlog.get_logger()

# Global engine and session factory
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_db() -> None:
    """Initialize the database connection pool."""
    global _engine, _session_factory

    settings = get_settings()
    database_url = str(settings.database_url)

    engine_kwargs: dict[str, object] = {
        "echo": settings.log_level == "DEBUG",
    }
    if settings.db_pool_mode == "null":
        engine_kwargs["poolclass"] = NullPool
    else:
        # QueuePool-backed defaults for long-running container workloads.
        engine_kwargs["pool_size"] = max(1, int(settings.db_pool_size))
        engine_kwargs["max_overflow"] = max(0, int(settings.db_pool_max_overflow))
        engine_kwargs["pool_timeout"] = max(1, int(settings.db_pool_timeout_seconds))
        engine_kwargs["pool_recycle"] = max(60, int(settings.db_pool_recycle_seconds))
        engine_kwargs["pool_pre_ping"] = True

    # Create async engine
    _engine = create_async_engine(
        database_url,
        **engine_kwargs,
    )

    # Create session factory
    _session_factory = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    logger.info(
        "Database connection pool initialized",
        url=database_url[:50] + "...",
        pool_mode=settings.db_pool_mode,
    )


async def close_db() -> None:
    """Close the database connection pool."""
    global _engine, _session_factory

    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("Database connection pool closed")


def get_async_engine() -> AsyncEngine:
    """Get the async engine instance."""
    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _engine


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Get an async database session.

    Usage:
        async with get_db_session() as session:
            result = await session.execute(...)
    """
    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    session = _session_factory()
    try:
        org_id = get_rls_context()
        is_internal = is_rls_internal()
        if org_id:
            await session.execute(
                text("SELECT set_config('app.organization_id', :org_id, true)"),
                {"org_id": org_id},
            )
        if is_internal:
            await session.execute(
                text("SELECT set_config('app.is_internal', 'true', true)")
            )
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


# Legacy asyncpg pool support
# Some modules use direct asyncpg pool for raw SQL queries
_pool = None


async def get_db_pool():
    """
    Get an asyncpg connection pool for raw SQL queries.

    This is used by modules that need direct database access outside SQLAlchemy.
    """
    global _pool
    if _pool is None:
        import asyncpg
        import json
        settings = get_settings()
        # Convert SQLAlchemy URL to asyncpg format
        db_url = str(settings.database_url).replace("postgresql+asyncpg://", "postgresql://")

        async def _init_connection(conn: asyncpg.Connection) -> None:
            # asyncpg defaults to returning JSON/JSONB as strings and expects strings on inserts.
            # Register codecs so we can transparently pass Python dict/list values for JSON columns.
            await conn.set_type_codec(
                "json",
                encoder=json.dumps,
                decoder=json.loads,
                schema="pg_catalog",
            )
            await conn.set_type_codec(
                "jsonb",
                encoder=json.dumps,
                decoder=json.loads,
                schema="pg_catalog",
                format="text",
            )

        raw_pool = await asyncpg.create_pool(
            db_url,
            init=_init_connection,
            min_size=max(1, int(settings.db_raw_pool_min_size)),
            max_size=max(
                max(1, int(settings.db_raw_pool_min_size)),
                int(settings.db_raw_pool_max_size),
            ),
        )
        _pool = _RLSAwarePool(raw_pool)
    return _pool


class _RLSAwarePool:
    """Proxy wrapper that sets RLS context on acquired connections."""

    def __init__(self, pool):
        self._pool = pool

    def acquire(self):
        return _RLSConnectionContext(self._pool.acquire())

    def __getattr__(self, name):
        return getattr(self._pool, name)


class _RLSConnectionContext:
    """Context manager that sets app.organization_id for RLS."""

    def __init__(self, acquire_cm):
        self._acquire_cm = acquire_cm
        self._conn = None

    async def __aenter__(self):
        self._conn = await self._acquire_cm.__aenter__()
        org_id = get_rls_context()
        is_internal = is_rls_internal()
        if org_id:
            await self._conn.execute(
                "SELECT set_config('app.organization_id', $1, true)",
                org_id,
            )
        if is_internal:
            await self._conn.execute(
                "SELECT set_config('app.is_internal', 'true', true)"
            )
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return await self._acquire_cm.__aexit__(exc_type, exc, tb)


async def close_db_pool():
    """Close the asyncpg connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
