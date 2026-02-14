"""Database port layer for raw query pool access.

This module is the only supported entrypoint for asyncpg raw pool usage
outside the db package. It keeps pooling concerns behind a small port so
presentation/application layers do not depend on db client internals.
"""

from __future__ import annotations

from typing import Any, Protocol


class RawQueryPool(Protocol):
    """Minimal protocol used by raw SQL callers."""

    def acquire(self) -> Any:
        ...


async def get_raw_query_pool() -> RawQueryPool:
    from src.db.client import get_db_pool

    return await get_db_pool()
