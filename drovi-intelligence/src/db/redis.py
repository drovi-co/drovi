"""Redis client utilities.

Centralizes Redis access for features like:
- API rate limiting
- brief caching
- connector sync event pub/sub
"""

from __future__ import annotations

import redis.asyncio as redis

from src.config import get_settings

_client: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    """Get (and lazily initialize) the shared Redis client."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = redis.from_url(str(settings.redis_url))
    return _client


async def close_redis() -> None:
    """Close the shared Redis client (best-effort)."""
    global _client
    if _client is None:
        return
    try:
        await _client.aclose()
    except Exception:
        pass
    _client = None

