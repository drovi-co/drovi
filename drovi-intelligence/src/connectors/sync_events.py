"""
Sync Event Broadcasting

Simple pub/sub for real-time sync status updates using Redis.
"""

import asyncio
import json
from datetime import datetime
from typing import Any
from typing import AsyncIterator

import redis.asyncio as redis
import structlog
from pydantic import BaseModel

from src.config import get_settings

logger = structlog.get_logger()

SYNC_EVENTS_CHANNEL = "sync_events:{org_id}"


class SyncEvent(BaseModel):
    """Sync status event."""

    event_type: str  # "started", "progress", "completed", "failed"
    connection_id: str
    organization_id: str
    connector_type: str
    job_id: str | None = None
    records_synced: int = 0
    total_records: int | None = None
    progress: float | None = None  # 0.0 to 1.0
    status: str = "syncing"
    error: str | None = None
    # Optional metadata (e.g., backfill window index/total) for UI progress.
    sync_params: dict[str, Any] | None = None
    timestamp: datetime | None = None

    def model_post_init(self, __context):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


class SyncEventBroadcaster:
    """Broadcasts sync events to subscribers via Redis pub/sub."""

    _instance: "SyncEventBroadcaster | None" = None

    def __init__(self):
        self._redis: redis.Redis | None = None

    @classmethod
    def get_instance(cls) -> "SyncEventBroadcaster":
        if cls._instance is None:
            cls._instance = SyncEventBroadcaster()
        return cls._instance

    async def _get_redis(self) -> redis.Redis:
        if self._redis is None:
            settings = get_settings()
            self._redis = redis.from_url(str(settings.redis_url))
        return self._redis

    async def publish(self, event: SyncEvent) -> None:
        """Publish a sync event."""
        try:
            r = await self._get_redis()
            channel = SYNC_EVENTS_CHANNEL.format(org_id=event.organization_id)
            await r.publish(channel, event.model_dump_json())
            logger.debug(
                "Published sync event",
                event_type=event.event_type,
                connection_id=event.connection_id,
            )
        except Exception as e:
            logger.warning("Failed to publish sync event", error=str(e))

    async def subscribe(self, organization_id: str) -> AsyncIterator[SyncEvent]:
        """Subscribe to sync events for an organization."""
        settings = get_settings()
        r = redis.from_url(str(settings.redis_url))
        pubsub = r.pubsub()

        channel = SYNC_EVENTS_CHANNEL.format(org_id=organization_id)
        await pubsub.subscribe(channel)

        logger.info("Subscribed to sync events", organization_id=organization_id)

        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        yield SyncEvent(**data)
                    except Exception as e:
                        logger.warning("Failed to parse sync event", error=str(e))
        finally:
            await pubsub.unsubscribe(channel)
            await r.aclose()


# Convenience functions
_broadcaster: SyncEventBroadcaster | None = None


def get_broadcaster() -> SyncEventBroadcaster:
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = SyncEventBroadcaster()
    return _broadcaster


async def publish_sync_event(event: SyncEvent) -> None:
    """Publish a sync event."""
    await get_broadcaster().publish(event)


async def emit_sync_started(
    connection_id: str,
    organization_id: str,
    connector_type: str,
    job_id: str,
    sync_params: dict[str, Any] | None = None,
) -> None:
    """Emit sync started event."""
    await publish_sync_event(
        SyncEvent(
            event_type="started",
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            job_id=job_id,
            status="syncing",
            sync_params=sync_params,
        )
    )


async def emit_sync_progress(
    connection_id: str,
    organization_id: str,
    connector_type: str,
    job_id: str,
    records_synced: int,
    total_records: int | None = None,
    sync_params: dict[str, Any] | None = None,
) -> None:
    """Emit sync progress event."""
    progress = None
    if total_records and total_records > 0:
        progress = records_synced / total_records

    await publish_sync_event(
        SyncEvent(
            event_type="progress",
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            job_id=job_id,
            records_synced=records_synced,
            total_records=total_records,
            progress=progress,
            status="syncing",
            sync_params=sync_params,
        )
    )


async def emit_sync_completed(
    connection_id: str,
    organization_id: str,
    connector_type: str,
    job_id: str,
    records_synced: int,
    sync_params: dict[str, Any] | None = None,
) -> None:
    """Emit sync completed event."""
    await publish_sync_event(
        SyncEvent(
            event_type="completed",
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            job_id=job_id,
            records_synced=records_synced,
            progress=1.0,
            status="connected",
            sync_params=sync_params,
        )
    )


async def emit_sync_failed(
    connection_id: str,
    organization_id: str,
    connector_type: str,
    job_id: str,
    error: str,
    records_synced: int = 0,
    sync_params: dict[str, Any] | None = None,
) -> None:
    """Emit sync failed event."""
    await publish_sync_event(
        SyncEvent(
            event_type="failed",
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            job_id=job_id,
            records_synced=records_synced,
            status="error",
            error=error,
            sync_params=sync_params,
        )
    )
