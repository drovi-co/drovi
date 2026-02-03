"""
Context Cache for Orchestrator Memory Retrieval.

Caches per-conversation memory context to keep extraction latency low.
Uses Redis when available with a lightweight in-memory fallback.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass
class _CacheEntry:
    payload: dict[str, Any]
    expires_at: datetime


class ContextCache:
    """Cache wrapper for per-conversation context."""

    _instance: "ContextCache | None" = None

    def __init__(self) -> None:
        self._redis = None
        self._local_cache: dict[str, _CacheEntry] = {}

    @classmethod
    def get_instance(cls) -> "ContextCache":
        if cls._instance is None:
            cls._instance = ContextCache()
        return cls._instance

    async def _get_redis(self):
        if self._redis is None:
            settings = get_settings()
            if not settings.context_cache_enabled:
                return None
            try:
                import redis.asyncio as redis

                self._redis = redis.from_url(str(settings.redis_url))
            except Exception as exc:
                logger.warning("Context cache Redis unavailable", error=str(exc))
                self._redis = None
        return self._redis

    async def get(self, key: str) -> dict[str, Any] | None:
        settings = get_settings()
        if not settings.context_cache_enabled:
            return None

        redis_client = await self._get_redis()
        if redis_client:
            try:
                cached = await redis_client.get(key)
                if cached:
                    return json.loads(cached)
            except Exception as exc:
                logger.warning("Context cache read failed", error=str(exc))

        entry = self._local_cache.get(key)
        if entry and entry.expires_at > datetime.utcnow():
            return entry.payload
        if entry:
            del self._local_cache[key]
        return None

    async def set(self, key: str, payload: dict[str, Any], ttl_seconds: int | None = None) -> None:
        settings = get_settings()
        if not settings.context_cache_enabled:
            return

        ttl = ttl_seconds if ttl_seconds is not None else settings.context_cache_ttl_seconds
        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.setex(key, ttl, json.dumps(payload))
                return
            except Exception as exc:
                logger.warning("Context cache write failed", error=str(exc))

        expires_at = datetime.utcnow() + timedelta(seconds=ttl)
        self._local_cache[key] = _CacheEntry(payload=payload, expires_at=expires_at)


async def get_context_cache() -> ContextCache:
    return ContextCache.get_instance()
