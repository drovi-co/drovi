"""
Real-Time Stream API

Server-Sent Events (SSE) endpoint for real-time graph change subscriptions.
Integrates with Kafka streaming infrastructure for sub-second latency.

Features:
- Real-time graph change notifications
- Node type filtering
- Organization-scoped subscriptions
- Heartbeat for connection keepalive
- Graceful disconnection handling
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import structlog
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from src.kernel.time import utc_now_naive

logger = structlog.get_logger()

router = APIRouter(prefix="/stream", tags=["Real-Time Stream"])


class GraphChangeStream:
    """
    Real-time graph change stream.

    Subscribes to graph change events from Kafka and yields SSE-formatted events.
    """

    def __init__(
        self,
        organization_id: str,
        node_types: list[str] | None = None,
        change_types: list[str] | None = None,
        heartbeat_interval: float = 30.0,
    ):
        """
        Initialize graph change stream.

        Args:
            organization_id: Organization to subscribe to
            node_types: Optional filter for node types (Commitment, Decision, etc.)
            change_types: Optional filter for change types (created, updated, deleted)
            heartbeat_interval: Seconds between heartbeat events
        """
        self.organization_id = organization_id
        self.node_types = set(node_types) if node_types else None
        self.change_types = set(change_types) if change_types else None
        self.heartbeat_interval = heartbeat_interval
        self._running = False
        self._event_queue: asyncio.Queue = asyncio.Queue()

    async def __aenter__(self) -> "GraphChangeStream":
        """Enter context and start listening."""
        self._running = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context and stop listening."""
        self._running = False

    def _matches_filter(self, event: dict[str, Any]) -> bool:
        """Check if an event matches the configured filters."""
        payload = event.get("payload", {})

        # Check organization
        if payload.get("organization_id") != self.organization_id:
            return False

        # Check node type filter
        if self.node_types:
            node_type = payload.get("node_type")
            if node_type not in self.node_types:
                return False

        # Check change type filter
        if self.change_types:
            change_type = payload.get("change_type")
            if change_type not in self.change_types:
                return False

        return True

    async def _kafka_listener(self) -> None:
        """Listen to Kafka for graph changes."""
        try:
            from src.streaming.kafka_consumer import get_kafka_consumer
            from src.config import get_settings

            settings = get_settings()
            consumer = await get_kafka_consumer([settings.kafka_topic_graph_changes])

            # Register handler that puts events in our queue
            async def handle_change(message: dict[str, Any]) -> None:
                if self._matches_filter(message):
                    await self._event_queue.put(message)

            consumer.register_handler(
                settings.kafka_topic_graph_changes,
                handle_change,
            )

            # Start consuming (this will run until stopped)
            await consumer.start()

        except ImportError:
            logger.warning("Kafka not available, using mock events")
            # Generate mock events for testing
            while self._running:
                await asyncio.sleep(5.0)
                mock_event = {
                    "payload": {
                        "change_type": "mock",
                        "node_type": "Test",
                        "node_id": "test-123",
                        "organization_id": self.organization_id,
                        "properties": {"mock": True},
                    }
                }
                if self._matches_filter(mock_event):
                    await self._event_queue.put(mock_event)
        except Exception as e:
            logger.error("Kafka listener error", error=str(e))

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """
        Yield graph change events.

        Includes periodic heartbeats to keep the connection alive.
        """
        # Start Kafka listener task
        listener_task = asyncio.create_task(self._kafka_listener())

        try:
            while self._running:
                try:
                    # Wait for event with timeout for heartbeat
                    event = await asyncio.wait_for(
                        self._event_queue.get(),
                        timeout=self.heartbeat_interval,
                    )
                    yield event

                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield {
                        "type": "heartbeat",
                        "timestamp": utc_now_naive().isoformat(),
                    }

        finally:
            listener_task.cancel()
            try:
                await listener_task
            except asyncio.CancelledError:
                pass


async def _graph_change_generator(
    organization_id: str,
    node_types: list[str] | None = None,
    change_types: list[str] | None = None,
) -> AsyncIterator[str]:
    """
    Generate SSE events for graph changes.

    Yields SSE-formatted event strings.
    """
    # Send connection event
    yield _format_sse_event({
        "type": "connected",
        "organization_id": organization_id,
        "filters": {
            "node_types": node_types or ["*"],
            "change_types": change_types or ["*"],
        },
        "timestamp": utc_now_naive().isoformat(),
    }, event_type="connected")

    try:
        async with GraphChangeStream(
            organization_id=organization_id,
            node_types=node_types,
            change_types=change_types,
        ) as stream:
            async for event in stream.events():
                event_type = event.get("type", "change")

                if event_type == "heartbeat":
                    yield _format_sse_event(event, event_type="heartbeat")
                else:
                    payload = event.get("payload", {})
                    yield _format_sse_event(
                        {
                            "change_type": payload.get("change_type"),
                            "node_type": payload.get("node_type"),
                            "node_id": payload.get("node_id"),
                            "organization_id": payload.get("organization_id"),
                            "properties": payload.get("properties", {}),
                            "timestamp": utc_now_naive().isoformat(),
                        },
                        event_type=f"graph.{payload.get('change_type', 'change')}",
                    )

    except asyncio.CancelledError:
        logger.debug("Graph change stream cancelled", organization_id=organization_id)
    except Exception as e:
        logger.error("Graph change stream error", error=str(e))
        yield _format_sse_event({"type": "error", "message": str(e)}, event_type="error")


def _format_sse_event(data: dict[str, Any], event_type: str | None = None) -> str:
    """
    Format data as an SSE event string.

    Args:
        data: Event data to serialize
        event_type: Optional event type name

    Returns:
        SSE-formatted string
    """
    lines = []
    if event_type:
        lines.append(f"event: {event_type}")
    lines.append(f"data: {json.dumps(data)}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


@router.get("/changes")
async def stream_graph_changes(
    request: Request,
    organization_id: str = Query(..., description="Organization ID to stream changes for"),
    node_types: str | None = Query(
        None,
        description="Comma-separated list of node types (e.g., 'Commitment,Decision,Risk')",
    ),
    change_types: str | None = Query(
        None,
        description="Comma-separated list of change types (e.g., 'created,updated,deleted')",
    ),
) -> StreamingResponse:
    """
    Stream real-time graph changes via Server-Sent Events (SSE).

    This endpoint provides a live stream of graph changes for the specified organization.
    Changes are delivered with sub-second latency via Kafka streaming.

    Connect using EventSource in the browser:

    ```javascript
    const eventSource = new EventSource(
        '/api/v1/stream/changes?organization_id=xxx&node_types=Commitment,Decision'
    );

    // Handle connection
    eventSource.addEventListener('connected', (event) => {
        console.log('Connected:', JSON.parse(event.data));
    });

    // Handle graph changes
    eventSource.addEventListener('graph.created', (event) => {
        const data = JSON.parse(event.data);
        console.log('Node created:', data.node_type, data.node_id);
    });

    eventSource.addEventListener('graph.updated', (event) => {
        const data = JSON.parse(event.data);
        console.log('Node updated:', data.node_type, data.node_id);
    });

    eventSource.addEventListener('graph.deleted', (event) => {
        const data = JSON.parse(event.data);
        console.log('Node deleted:', data.node_type, data.node_id);
    });

    // Handle heartbeats (connection keepalive)
    eventSource.addEventListener('heartbeat', (event) => {
        console.log('Heartbeat:', JSON.parse(event.data).timestamp);
    });
    ```

    **Node Types:**
    - Commitment, Decision, Risk, Task, Claim, Question
    - Contact, Identity, Entity
    - RawMessage, ThreadContext, CommunicationEvent
    - Episode, Brief, Pattern, Signal

    **Change Types:**
    - created: New node added to graph
    - updated: Existing node properties changed
    - deleted: Node removed from graph
    - upserted: Node created or updated (MERGE operation)
    """
    parsed_node_types = node_types.split(",") if node_types else None
    parsed_change_types = change_types.split(",") if change_types else None

    return StreamingResponse(
        _graph_change_generator(
            organization_id=organization_id,
            node_types=parsed_node_types,
            change_types=parsed_change_types,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/intelligence")
async def stream_intelligence(
    request: Request,
    organization_id: str = Query(..., description="Organization ID to stream intelligence for"),
    intelligence_types: str | None = Query(
        None,
        description="Comma-separated list of intelligence types (e.g., 'commitment,decision,risk')",
    ),
) -> StreamingResponse:
    """
    Stream real-time extracted intelligence via Server-Sent Events (SSE).

    This endpoint provides a live stream of newly extracted intelligence objects
    as they are processed by the orchestrator pipeline.

    Connect using EventSource in the browser:

    ```javascript
    const eventSource = new EventSource(
        '/api/v1/stream/intelligence?organization_id=xxx&intelligence_types=commitment,decision'
    );

    eventSource.addEventListener('intelligence.commitment', (event) => {
        const data = JSON.parse(event.data);
        console.log('New commitment:', data);
    });

    eventSource.addEventListener('intelligence.decision', (event) => {
        const data = JSON.parse(event.data);
        console.log('New decision:', data);
    });
    ```

    **Intelligence Types:**
    - commitment: Extracted commitments
    - decision: Detected decisions
    - risk: Identified risks
    - task: Action items and tasks
    - claim: Factual claims
    - question: Open questions
    """
    parsed_types = intelligence_types.split(",") if intelligence_types else None

    async def intelligence_generator() -> AsyncIterator[str]:
        """Generate SSE events for intelligence extraction."""
        yield _format_sse_event({
            "type": "connected",
            "organization_id": organization_id,
            "filters": {
                "intelligence_types": parsed_types or ["*"],
            },
            "timestamp": utc_now_naive().isoformat(),
        }, event_type="connected")

        try:
            from src.streaming.kafka_consumer import get_kafka_consumer
            from src.config import get_settings

            settings = get_settings()
            event_queue: asyncio.Queue = asyncio.Queue()

            async def handle_intelligence(message: dict[str, Any]) -> None:
                payload = message.get("payload", {})
                if payload.get("organization_id") != organization_id:
                    return
                if parsed_types:
                    itype = payload.get("intelligence_type", "").lower()
                    if itype not in parsed_types:
                        return
                await event_queue.put(payload)

            consumer = await get_kafka_consumer([settings.kafka_topic_intelligence])
            consumer.register_handler(
                settings.kafka_topic_intelligence,
                handle_intelligence,
            )

            # Start consumer in background
            consumer_task = asyncio.create_task(consumer.start())

            try:
                while True:
                    try:
                        payload = await asyncio.wait_for(
                            event_queue.get(),
                            timeout=30.0,
                        )
                        itype = payload.get("intelligence_type", "unknown")
                        yield _format_sse_event(
                            payload,
                            event_type=f"intelligence.{itype}",
                        )
                    except asyncio.TimeoutError:
                        yield _format_sse_event(
                            {"timestamp": utc_now_naive().isoformat()},
                            event_type="heartbeat",
                        )
            finally:
                consumer_task.cancel()
                try:
                    await consumer_task
                except asyncio.CancelledError:
                    pass

        except ImportError:
            logger.warning("Kafka not available for intelligence streaming")
            while True:
                await asyncio.sleep(30.0)
                yield _format_sse_event(
                    {"timestamp": utc_now_naive().isoformat()},
                    event_type="heartbeat",
                )

    return StreamingResponse(
        intelligence_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/health")
async def stream_health() -> dict[str, Any]:
    """
    Check health of the streaming infrastructure.

    Returns status of Kafka and FalkorDB connections.
    """
    kafka_status = "unknown"
    falkordb_status = "unknown"

    try:
        from src.streaming.kafka_producer import get_kafka_producer
        producer = await get_kafka_producer()
        kafka_status = "connected" if producer._producer else "mock_mode"
    except Exception as e:
        kafka_status = f"error: {str(e)}"

    try:
        from src.graph.client import get_graph_client
        graph = await get_graph_client()
        await graph.query("RETURN 1")
        falkordb_status = "connected"
    except Exception as e:
        falkordb_status = f"error: {str(e)}"

    return {
        "status": "healthy" if kafka_status == "connected" else "degraded",
        "kafka": kafka_status,
        "falkordb": falkordb_status,
        "timestamp": utc_now_naive().isoformat(),
    }
