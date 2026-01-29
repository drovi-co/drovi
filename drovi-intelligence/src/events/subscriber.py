"""
Event Subscriber

Subscribes to Redis Pub/Sub channels for real-time event streaming.
"""

from collections.abc import AsyncIterator, Callable, Awaitable
from typing import Any
import asyncio

import structlog

from src.events.types import Event, EventType, get_channel_name, get_broadcast_channel

logger = structlog.get_logger()

# Type for event handlers
EventHandler = Callable[[Event], Awaitable[None]]


class EventSubscriber:
    """
    Subscribes to Redis Pub/Sub channels and processes events.

    Supports:
    - Organization-scoped subscriptions
    - Event-type filtered subscriptions
    - Broadcast subscriptions
    - Handler-based processing
    - Async iteration
    """

    def __init__(self, redis_url: str | None = None):
        """Initialize the event subscriber."""
        self._redis_url = redis_url
        self._redis = None
        self._pubsub = None
        self._handlers: dict[str, list[EventHandler]] = {}
        self._running = False
        self._task: asyncio.Task | None = None

    async def connect(self) -> None:
        """Connect to Redis."""
        try:
            import redis.asyncio as redis

            if not self._redis_url:
                from src.config import get_settings
                settings = get_settings()
                self._redis_url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')

            self._redis = redis.from_url(self._redis_url)
            self._pubsub = self._redis.pubsub()
            await self._redis.ping()
            logger.info("Event subscriber connected to Redis")

        except ImportError:
            logger.warning("redis package not installed, event subscription disabled")
        except Exception as e:
            logger.error("Failed to connect to Redis", error=str(e))

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        if self._pubsub:
            await self._pubsub.close()
            self._pubsub = None

        if self._redis:
            await self._redis.close()
            self._redis = None

        logger.info("Event subscriber disconnected from Redis")

    async def subscribe_to_organization(
        self,
        organization_id: str,
        event_types: list[EventType] | None = None,
    ) -> None:
        """
        Subscribe to events for an organization.

        Args:
            organization_id: Organization to subscribe to
            event_types: Optional list of specific event types to subscribe to
        """
        if not self._pubsub:
            await self.connect()

        if not self._pubsub:
            return

        if event_types:
            # Subscribe to specific event types
            channels = [
                get_channel_name(organization_id, et)
                for et in event_types
            ]
        else:
            # Subscribe to all events for the organization
            channels = [get_channel_name(organization_id)]

        await self._pubsub.subscribe(*channels)
        logger.info(
            "Subscribed to organization events",
            organization_id=organization_id,
            channels=channels,
        )

    async def subscribe_to_broadcast(
        self,
        event_types: list[EventType] | None = None,
    ) -> None:
        """
        Subscribe to broadcast events.

        Args:
            event_types: Optional list of specific event types to subscribe to
        """
        if not self._pubsub:
            await self.connect()

        if not self._pubsub:
            return

        if event_types:
            channels = [get_broadcast_channel(et) for et in event_types]
        else:
            channels = [get_broadcast_channel()]

        await self._pubsub.subscribe(*channels)
        logger.info("Subscribed to broadcast events", channels=channels)

    async def unsubscribe(self, channels: list[str]) -> None:
        """Unsubscribe from specific channels."""
        if self._pubsub:
            await self._pubsub.unsubscribe(*channels)
            logger.info("Unsubscribed from channels", channels=channels)

    def add_handler(
        self,
        event_type: EventType | str,
        handler: EventHandler,
    ) -> None:
        """
        Add a handler for a specific event type.

        Args:
            event_type: Event type to handle (or "*" for all events)
            handler: Async function to call when event is received
        """
        key = event_type.value if isinstance(event_type, EventType) else event_type
        if key not in self._handlers:
            self._handlers[key] = []
        self._handlers[key].append(handler)

    def remove_handler(
        self,
        event_type: EventType | str,
        handler: EventHandler,
    ) -> None:
        """Remove a handler for an event type."""
        key = event_type.value if isinstance(event_type, EventType) else event_type
        if key in self._handlers and handler in self._handlers[key]:
            self._handlers[key].remove(handler)

    async def _dispatch_event(self, event: Event) -> None:
        """Dispatch event to registered handlers."""
        # Call type-specific handlers
        type_key = event.event_type.value
        if type_key in self._handlers:
            for handler in self._handlers[type_key]:
                try:
                    await handler(event)
                except Exception as e:
                    logger.error(
                        "Event handler failed",
                        event_type=type_key,
                        error=str(e),
                    )

        # Call catch-all handlers
        if "*" in self._handlers:
            for handler in self._handlers["*"]:
                try:
                    await handler(event)
                except Exception as e:
                    logger.error(
                        "Catch-all handler failed",
                        event_type=type_key,
                        error=str(e),
                    )

    async def listen(self) -> AsyncIterator[Event]:
        """
        Listen for events as an async iterator.

        Yields:
            Event objects as they are received
        """
        if not self._pubsub:
            await self.connect()

        if not self._pubsub:
            return

        self._running = True

        try:
            while self._running:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )

                if message and message["type"] == "message":
                    try:
                        data = message["data"]
                        if isinstance(data, bytes):
                            data = data.decode("utf-8")

                        event = Event.from_json(data)
                        yield event

                    except Exception as e:
                        logger.error(
                            "Failed to parse event",
                            error=str(e),
                            data=str(message.get("data", ""))[:100],
                        )

        except asyncio.CancelledError:
            pass
        finally:
            self._running = False

    async def start_processing(self) -> None:
        """
        Start processing events in the background.

        Events will be dispatched to registered handlers.
        """
        if self._running:
            return

        async def _process_loop():
            async for event in self.listen():
                await self._dispatch_event(event)

        self._task = asyncio.create_task(_process_loop())
        logger.info("Event processing started")

    async def stop_processing(self) -> None:
        """Stop background event processing."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Event processing stopped")


# Factory function
async def get_event_subscriber() -> EventSubscriber:
    """Create a new event subscriber instance."""
    subscriber = EventSubscriber()
    await subscriber.connect()
    return subscriber


class EventStream:
    """
    Context manager for streaming events to clients (e.g., SSE).

    Usage:
        async with EventStream(organization_id) as stream:
            async for event in stream:
                yield f"data: {event.to_json()}\\n\\n"
    """

    def __init__(
        self,
        organization_id: str,
        event_types: list[EventType] | None = None,
        include_broadcast: bool = False,
    ):
        """Initialize event stream."""
        self.organization_id = organization_id
        self.event_types = event_types
        self.include_broadcast = include_broadcast
        self._subscriber: EventSubscriber | None = None

    async def __aenter__(self) -> "EventStream":
        """Enter context and subscribe."""
        self._subscriber = await get_event_subscriber()
        await self._subscriber.subscribe_to_organization(
            self.organization_id,
            self.event_types,
        )
        if self.include_broadcast:
            await self._subscriber.subscribe_to_broadcast(self.event_types)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context and disconnect."""
        if self._subscriber:
            await self._subscriber.disconnect()

    def __aiter__(self) -> AsyncIterator[Event]:
        """Iterate over events."""
        if self._subscriber:
            return self._subscriber.listen()
        raise RuntimeError("EventStream not initialized")
