"""
Event Publisher

Publishes events to Redis Pub/Sub for real-time streaming to subscribers.
Also persists events to PostgreSQL for reliability and replay.
"""

from datetime import datetime, timedelta
from typing import Any
import asyncio

import structlog
from sqlalchemy import select, delete

from src.events.types import Event, EventType, get_channel_name, get_broadcast_channel

logger = structlog.get_logger()

# Singleton instance
_publisher: "EventPublisher | None" = None


class EventPublisher:
    """
    Publishes events to Redis Pub/Sub channels with database persistence.

    Events are published to:
    1. Organization-specific channel (for org-scoped subscribers)
    2. Event-type specific channel (for type-filtered subscribers)
    3. Broadcast channel (for system-wide subscribers)
    4. PostgreSQL database (for persistence and replay)
    """

    def __init__(self, redis_url: str | None = None, persist_events: bool = True):
        """Initialize the event publisher."""
        self._redis_url = redis_url
        self._redis = None
        self._connected = False
        self._persist_events = persist_events

    async def connect(self) -> None:
        """Connect to Redis."""
        if self._connected:
            return

        try:
            import redis.asyncio as redis

            if not self._redis_url:
                from src.config import get_settings
                settings = get_settings()
                self._redis_url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')

            self._redis = redis.from_url(self._redis_url)
            await self._redis.ping()
            self._connected = True
            logger.info("Event publisher connected to Redis")

        except ImportError:
            logger.warning("redis package not installed, event publishing disabled")
        except Exception as e:
            logger.error("Failed to connect to Redis", error=str(e))

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self._redis:
            await self._redis.close()
            self._redis = None
            self._connected = False
            logger.info("Event publisher disconnected from Redis")

    async def publish(self, event: Event, broadcast: bool = False) -> bool:
        """
        Publish an event to Redis Pub/Sub and persist to database.

        Args:
            event: The event to publish
            broadcast: If True, also publish to broadcast channel

        Returns:
            True if published successfully, False otherwise
        """
        if not self._connected:
            await self.connect()

        published = False

        # Persist to database first (for reliability)
        if self._persist_events:
            try:
                await self._persist_event(event)
            except Exception as e:
                logger.error(
                    "Failed to persist event",
                    event_id=event.event_id,
                    error=str(e),
                )
                # Continue with Redis publish even if persistence fails

        # Publish to Redis
        if self._redis:
            try:
                json_data = event.to_json()

                # Publish to organization channel
                org_channel = get_channel_name(event.organization_id)
                await self._redis.publish(org_channel, json_data)

                # Publish to event-type specific channel
                type_channel = get_channel_name(event.organization_id, event.event_type)
                await self._redis.publish(type_channel, json_data)

                # Optionally publish to broadcast channel
                if broadcast:
                    broadcast_channel = get_broadcast_channel()
                    await self._redis.publish(broadcast_channel, json_data)

                    type_broadcast = get_broadcast_channel(event.event_type)
                    await self._redis.publish(type_broadcast, json_data)

                published = True

                logger.debug(
                    "Event published",
                    event_id=event.event_id,
                    event_type=event.event_type.value,
                    organization_id=event.organization_id,
                )

            except Exception as e:
                logger.error(
                    "Failed to publish event to Redis",
                    event_id=event.event_id,
                    error=str(e),
                )
        else:
            # If Redis not available but persistence is enabled, still consider it published
            published = self._persist_events

        return published

    async def _persist_event(self, event: Event) -> None:
        """Persist event to database."""
        from src.db import get_db_session
        from src.db.models import EventRecord

        async with get_db_session() as session:
            record = EventRecord(
                id=event.event_id,
                organization_id=event.organization_id,
                event_type=event.event_type.value,
                payload=event.payload,
                correlation_id=event.correlation_id,
                source=event.source,
                created_at=event.timestamp,
            )
            session.add(record)

    async def get_events_since(
        self,
        organization_id: str,
        since: datetime,
        event_types: list[EventType] | None = None,
        limit: int = 100,
    ) -> list[Event]:
        """
        Get events since a specific time for replay.

        Args:
            organization_id: Organization ID
            since: Get events after this time
            event_types: Optional filter by event types
            limit: Maximum events to return

        Returns:
            List of events
        """
        from src.db import get_db_session
        from src.db.models import EventRecord

        async with get_db_session() as session:
            query = select(EventRecord).where(
                EventRecord.organization_id == organization_id,
                EventRecord.created_at > since,
            )

            if event_types:
                type_values = [et.value for et in event_types]
                query = query.where(EventRecord.event_type.in_(type_values))

            query = query.order_by(EventRecord.created_at).limit(limit)
            result = await session.execute(query)
            records = list(result.scalars().all())

            return [
                Event(
                    event_id=r.id,
                    event_type=EventType(r.event_type),
                    organization_id=r.organization_id,
                    payload=r.payload,
                    timestamp=r.created_at,
                    correlation_id=r.correlation_id,
                    source=r.source,
                )
                for r in records
            ]

    async def cleanup_old_events(self, days: int = 30) -> int:
        """
        Remove events older than specified days.

        Args:
            days: Delete events older than this many days

        Returns:
            Number of events deleted
        """
        from src.db import get_db_session
        from src.db.models import EventRecord

        cutoff = datetime.utcnow() - timedelta(days=days)

        async with get_db_session() as session:
            result = await session.execute(
                delete(EventRecord).where(EventRecord.created_at < cutoff)
            )
            deleted = result.rowcount
            logger.info("Cleaned up old events", deleted=deleted, days=days)
            return deleted

    async def publish_uio_event(
        self,
        event_type: EventType,
        organization_id: str,
        uio_id: str,
        uio_type: str,
        uio_data: dict[str, Any],
        correlation_id: str | None = None,
    ) -> bool:
        """
        Convenience method for publishing UIO lifecycle events.

        Args:
            event_type: Type of UIO event
            organization_id: Organization ID
            uio_id: UIO ID
            uio_type: Type of UIO (decision, commitment, task, risk)
            uio_data: Full UIO data
            correlation_id: Optional correlation ID for tracking

        Returns:
            True if published successfully
        """
        event = Event(
            event_type=event_type,
            organization_id=organization_id,
            payload={
                "uio_id": uio_id,
                "uio_type": uio_type,
                "data": uio_data,
            },
            correlation_id=correlation_id,
            source="orchestrator",
        )
        return await self.publish(event)

    async def publish_entity_event(
        self,
        event_type: EventType,
        organization_id: str,
        entity_id: str,
        entity_type: str,
        entity_data: dict[str, Any],
    ) -> bool:
        """Convenience method for publishing entity events."""
        event = Event(
            event_type=event_type,
            organization_id=organization_id,
            payload={
                "entity_id": entity_id,
                "entity_type": entity_type,
                "data": entity_data,
            },
            source="orchestrator",
        )
        return await self.publish(event)

    async def publish_sync_event(
        self,
        event_type: EventType,
        organization_id: str,
        connection_id: str,
        connector_type: str,
        details: dict[str, Any] | None = None,
    ) -> bool:
        """Convenience method for publishing sync events."""
        event = Event(
            event_type=event_type,
            organization_id=organization_id,
            payload={
                "connection_id": connection_id,
                "connector_type": connector_type,
                "details": details or {},
            },
            source="scheduler",
        )
        return await self.publish(event, broadcast=True)

    async def publish_commitment_due(
        self,
        organization_id: str,
        commitment_id: str,
        commitment_data: dict[str, Any],
        is_overdue: bool = False,
    ) -> bool:
        """Publish commitment due/overdue event."""
        event_type = EventType.COMMITMENT_OVERDUE if is_overdue else EventType.COMMITMENT_DUE
        event = Event(
            event_type=event_type,
            organization_id=organization_id,
            payload={
                "commitment_id": commitment_id,
                "data": commitment_data,
                "is_overdue": is_overdue,
            },
            source="scheduler",
        )
        return await self.publish(event)

    async def publish_risk_detected(
        self,
        organization_id: str,
        risk_id: str,
        risk_type: str,
        severity: str,
        risk_data: dict[str, Any],
    ) -> bool:
        """Publish risk detection event."""
        event = Event(
            event_type=EventType.RISK_DETECTED,
            organization_id=organization_id,
            payload={
                "risk_id": risk_id,
                "risk_type": risk_type,
                "severity": severity,
                "data": risk_data,
            },
            source="orchestrator",
        )
        return await self.publish(event)

    async def publish_contradiction_detected(
        self,
        organization_id: str,
        uio_id_1: str,
        uio_id_2: str,
        contradiction_details: dict[str, Any],
    ) -> bool:
        """Publish contradiction detection event."""
        event = Event(
            event_type=EventType.CONTRADICTION_DETECTED,
            organization_id=organization_id,
            payload={
                "uio_id_1": uio_id_1,
                "uio_id_2": uio_id_2,
                "details": contradiction_details,
            },
            source="orchestrator",
        )
        return await self.publish(event)


async def get_event_publisher() -> EventPublisher:
    """Get or create the singleton event publisher."""
    global _publisher
    if _publisher is None:
        _publisher = EventPublisher()
        await _publisher.connect()
    return _publisher
