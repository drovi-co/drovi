"""Document event broadcasting for Smart Drive realtime updates."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import redis.asyncio as redis
import structlog
from pydantic import BaseModel

from src.config import get_settings

logger = structlog.get_logger()

DOCUMENT_EVENTS_CHANNEL = "document_events:{org_id}"


class DocumentEvent(BaseModel):
    event_type: str  # uploaded|processing|processed|failed
    organization_id: str
    document_id: str
    status: str
    file_name: str | None = None
    page_count: int | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None
    timestamp: datetime | None = None

    def model_post_init(self, __context: Any) -> None:
        if self.timestamp is None:
            self.timestamp = datetime.now(timezone.utc)


class DocumentEventBroadcaster:
    _instance: "DocumentEventBroadcaster | None" = None

    def __init__(self) -> None:
        self._redis: redis.Redis | None = None

    @classmethod
    def get_instance(cls) -> "DocumentEventBroadcaster":
        if cls._instance is None:
            cls._instance = DocumentEventBroadcaster()
        return cls._instance

    async def _get_redis(self) -> redis.Redis:
        if self._redis is None:
            settings = get_settings()
            self._redis = redis.from_url(str(settings.redis_url))
        return self._redis

    async def publish(self, event: DocumentEvent) -> None:
        try:
            r = await self._get_redis()
            channel = DOCUMENT_EVENTS_CHANNEL.format(org_id=event.organization_id)
            await r.publish(channel, event.model_dump_json())
        except Exception as exc:
            logger.warning("Failed to publish document event", error=str(exc))

    async def subscribe(self, organization_id: str) -> AsyncIterator[DocumentEvent]:
        settings = get_settings()
        r = redis.from_url(str(settings.redis_url))
        pubsub = r.pubsub()
        channel = DOCUMENT_EVENTS_CHANNEL.format(org_id=organization_id)
        await pubsub.subscribe(channel)

        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    yield DocumentEvent(**data)
                except Exception as exc:
                    logger.warning("Failed to parse document event", error=str(exc))
        finally:
            await pubsub.unsubscribe(channel)
            await r.aclose()


_broadcaster: DocumentEventBroadcaster | None = None


def get_document_broadcaster() -> DocumentEventBroadcaster:
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = DocumentEventBroadcaster()
    return _broadcaster


async def publish_document_event(event: DocumentEvent) -> None:
    await get_document_broadcaster().publish(event)


async def emit_document_uploaded(
    *,
    organization_id: str,
    document_id: str,
    file_name: str | None = None,
) -> None:
    await publish_document_event(
        DocumentEvent(
            event_type="uploaded",
            organization_id=organization_id,
            document_id=document_id,
            status="uploaded",
            file_name=file_name,
        )
    )


async def emit_document_processing(
    *,
    organization_id: str,
    document_id: str,
    file_name: str | None = None,
) -> None:
    await publish_document_event(
        DocumentEvent(
            event_type="processing",
            organization_id=organization_id,
            document_id=document_id,
            status="processing",
            file_name=file_name,
        )
    )


async def emit_document_processed(
    *,
    organization_id: str,
    document_id: str,
    file_name: str | None = None,
    page_count: int | None = None,
) -> None:
    await publish_document_event(
        DocumentEvent(
            event_type="processed",
            organization_id=organization_id,
            document_id=document_id,
            status="processed",
            file_name=file_name,
            page_count=page_count,
        )
    )


async def emit_document_failed(
    *,
    organization_id: str,
    document_id: str,
    error: str,
    file_name: str | None = None,
) -> None:
    await publish_document_event(
        DocumentEvent(
            event_type="failed",
            organization_id=organization_id,
            document_id=document_id,
            status="failed",
            file_name=file_name,
            error=error,
        )
    )
