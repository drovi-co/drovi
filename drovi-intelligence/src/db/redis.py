"""Redis client helpers (async).

Used for:
- API rate limiting (token bucket)
- short-lived caches (context windows, brief caches, etc.)

This module is intentionally small and explicit. If Redis is unavailable, callers
should fail open for non-critical features like rate limiting in development.
"""

from __future__ import annotations

from typing import Any

import structlog
from redis.asyncio import Redis

from src.config import get_settings

logger = structlog.get_logger()

_redis: Redis | None = None


async def get_redis() -> Redis:
    """
    Return a singleton Redis client.

    Raises if a connection cannot be established.
    """
    global _redis
    if _redis is not None:
        return _redis

    settings = get_settings()
    client = Redis.from_url(str(settings.redis_url), decode_responses=True)
    try:
        await client.ping()
    except Exception as exc:
        try:
            await client.aclose()
        except Exception:
            pass
        logger.warning("Failed to connect to Redis", error=str(exc))
        raise

    _redis = client
    return _redis


async def close_redis() -> None:
    """Close the singleton Redis client (best-effort)."""
    global _redis
    if _redis is None:
        return
    try:
        await _redis.aclose()
    finally:
        _redis = None


async def redis_healthcheck() -> dict[str, Any]:
    """
    Best-effort health check used by ops endpoints.

    Returns a dict so callers can include it in JSON responses.
    """
    try:
        client = await get_redis()
        ok = await client.ping()
        return {"ok": bool(ok)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

