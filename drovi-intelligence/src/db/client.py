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

logger = structlog.get_logger()

# Global engine and session factory
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_db() -> None:
    """Initialize the database connection pool."""
    global _engine, _session_factory

    settings = get_settings()
    database_url = str(settings.database_url)

    # Create async engine
    _engine = create_async_engine(
        database_url,
        echo=settings.log_level == "DEBUG",
        poolclass=NullPool,  # Use NullPool for serverless compatibility
    )

    # Create session factory
    _session_factory = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    logger.info("Database connection pool initialized", url=database_url[:50] + "...")


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
        settings = get_settings()
        # Convert SQLAlchemy URL to asyncpg format
        db_url = str(settings.database_url).replace("postgresql+asyncpg://", "postgresql://")
        _pool = await asyncpg.create_pool(db_url)
    return _pool


async def close_db_pool():
    """Close the asyncpg connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
