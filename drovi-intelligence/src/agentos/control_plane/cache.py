from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass
class _LocalEntry:
    payload: dict[str, Any]
    expires_at: datetime


class SnapshotCache:
    """Cache for compiled deployment snapshots with Redis + local fallback."""

    _instance: "SnapshotCache | None" = None

    def __init__(self) -> None:
        self._redis = None
        self._local: dict[str, _LocalEntry] = {}

    @classmethod
    def get_instance(cls) -> "SnapshotCache":
        if cls._instance is None:
            cls._instance = SnapshotCache()
        return cls._instance

    @staticmethod
    def key(organization_id: str, deployment_id: str) -> str:
        return f"drovi:agentos:snapshot:{organization_id}:{deployment_id}"

    async def _get_redis(self):
        if self._redis is None:
            settings = get_settings()
            try:
                import redis.asyncio as redis

                self._redis = redis.from_url(str(settings.redis_url))
            except Exception as exc:
                logger.warning("AgentOS snapshot cache Redis unavailable", error=str(exc))
                self._redis = None
        return self._redis

    async def get(self, organization_id: str, deployment_id: str) -> dict[str, Any] | None:
        key = self.key(organization_id, deployment_id)
        redis_client = await self._get_redis()
        if redis_client:
            try:
                cached = await redis_client.get(key)
                if cached:
                    return json.loads(cached)
            except Exception as exc:
                logger.warning("AgentOS snapshot cache read failed", key=key, error=str(exc))

        entry = self._local.get(key)
        if entry and entry.expires_at > datetime.utcnow():
            return entry.payload
        if entry:
            del self._local[key]
        return None

    async def set(
        self,
        organization_id: str,
        deployment_id: str,
        payload: dict[str, Any],
        ttl_seconds: int | None = None,
    ) -> None:
        settings = get_settings()
        ttl = ttl_seconds if ttl_seconds is not None else settings.context_cache_ttl_seconds
        key = self.key(organization_id, deployment_id)

        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.setex(key, ttl, json.dumps(payload))
                return
            except Exception as exc:
                logger.warning("AgentOS snapshot cache write failed", key=key, error=str(exc))

        self._local[key] = _LocalEntry(
            payload=payload,
            expires_at=datetime.utcnow() + timedelta(seconds=ttl),
        )

    async def invalidate(self, organization_id: str, deployment_id: str) -> None:
        key = self.key(organization_id, deployment_id)
        redis_client = await self._get_redis()
        if redis_client:
            try:
                await redis_client.delete(key)
            except Exception as exc:
                logger.warning("AgentOS snapshot cache invalidate failed", key=key, error=str(exc))
        self._local.pop(key, None)

