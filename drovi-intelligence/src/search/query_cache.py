"""
Redis-backed cache for hot search workloads.

Fail-open by design: cache failures never block serving fresh results.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()

SEARCH_QUERY_CACHE_PREFIX = "drovi:search:hybrid:v1:"
SEARCH_QUERY_CACHE_TTL_SECONDS = 45
MAX_SEARCH_CACHE_BYTES = 256_000

_redis_client = None


async def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis.asyncio as redis

        redis_url = str(get_settings().redis_url)
        _redis_client = redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


def build_search_cache_key(
    *,
    organization_id: str,
    query: str,
    types: list[str] | None,
    source_types: list[str] | None,
    time_range: dict[str, Any] | None,
    include_graph_context: bool,
    limit: int,
    visibility_scope: str,
) -> str:
    """
    Build a stable cache key for visibility-scoped search requests.
    """
    payload = {
        "organization_id": organization_id,
        "query": (query or "").strip().lower(),
        "types": sorted(types or []),
        "source_types": sorted(source_types or []),
        "time_range": time_range or {},
        "include_graph_context": bool(include_graph_context),
        "limit": int(limit),
        "visibility_scope": visibility_scope,
    }
    normalized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{SEARCH_QUERY_CACHE_PREFIX}{digest}"


async def get_cached_search_response(cache_key: str) -> dict[str, Any] | None:
    try:
        redis = await _get_redis()
        cached = await redis.get(cache_key)
        if not cached:
            return None
        parsed = json.loads(cached)
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:  # noqa: BLE001 - must remain fail-open
        logger.debug("Search cache read failed", cache_key=cache_key, error=str(exc))
        return None


async def cache_search_response(cache_key: str, payload: dict[str, Any]) -> None:
    try:
        serialized = json.dumps(payload, separators=(",", ":"), default=str)
        if len(serialized.encode("utf-8")) > MAX_SEARCH_CACHE_BYTES:
            return
        redis = await _get_redis()
        await redis.setex(cache_key, SEARCH_QUERY_CACHE_TTL_SECONDS, serialized)
    except Exception as exc:  # noqa: BLE001 - must remain fail-open
        logger.debug("Search cache write failed", cache_key=cache_key, error=str(exc))
