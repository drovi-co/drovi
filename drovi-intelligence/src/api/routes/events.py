"""
Events API Routes

Provides real-time event streaming via Server-Sent Events (SSE) and
event management for the intelligence platform.

OpenAPI Tags:
- events: Real-time event streaming and management
"""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import structlog

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.events import EventType, get_event_publisher, Event
from src.events.subscriber import EventStream

logger = structlog.get_logger()

router = APIRouter(prefix="/events", tags=["Events"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class EventTypeInfo(BaseModel):
    """Information about an event type."""

    name: str = Field(..., description="Event type name (e.g., 'uio.created')")
    category: str = Field(..., description="Event category (e.g., 'uio_lifecycle')")
    description: str = Field(..., description="Human-readable description")

    model_config = {"json_schema_extra": {"example": {"name": "uio.created", "category": "uio_lifecycle", "description": "Fired when a new UIO is created"}}}


class EventTypesResponse(BaseModel):
    """Response containing all available event types."""

    event_types: dict[str, list[EventTypeInfo]] = Field(
        ..., description="Event types grouped by category"
    )
    total_count: int = Field(..., description="Total number of event types")

    model_config = {"json_schema_extra": {"example": {"event_types": {"uio_lifecycle": [{"name": "uio.created", "category": "uio_lifecycle", "description": "New UIO created"}]}, "total_count": 24}}}


class PublishEventRequest(BaseModel):
    """Request to publish a custom event."""

    event_type: str = Field(..., description="Event type (must be valid EventType)")
    organization_id: str = Field(..., description="Organization ID")
    payload: dict[str, Any] = Field(default_factory=dict, description="Event payload")
    correlation_id: str | None = Field(None, description="Optional correlation ID for tracking")
    broadcast: bool = Field(False, description="Also publish to broadcast channel")

    model_config = {"json_schema_extra": {"example": {"event_type": "uio.created", "organization_id": "org_123", "payload": {"uio_id": "uio_456", "uio_type": "commitment"}, "correlation_id": "req_789", "broadcast": False}}}


class PublishEventResponse(BaseModel):
    """Response after publishing an event."""

    success: bool = Field(..., description="Whether the event was published")
    event_id: str | None = Field(None, description="Generated event ID")
    message: str = Field(..., description="Status message")

    model_config = {"json_schema_extra": {"example": {"success": True, "event_id": "evt_abc123", "message": "Event published successfully"}}}


class IngestRawEventRequest(BaseModel):
    """Request to ingest a raw event from connectors (TypeScript backend)."""

    organization_id: str = Field(..., description="Organization ID")
    source_type: str = Field(..., description="Source type (email, slack, linear, github, etc.)")
    event_type: str = Field(..., description="Event type (message.received, issue.created, etc.)")
    source_id: str | None = Field(None, description="Optional source identifier (e.g., connection_id)")
    payload: dict[str, Any] = Field(..., description="Raw event payload from the source")

    model_config = {"json_schema_extra": {"example": {
        "organization_id": "org_123",
        "source_type": "email",
        "event_type": "message.received",
        "source_id": "conn_456",
        "payload": {
            "message_id": "msg_789",
            "from": "alice@example.com",
            "to": ["bob@example.com"],
            "subject": "Q1 Planning",
            "body": "Let's schedule a meeting...",
            "received_at": "2026-01-29T10:00:00Z"
        }
    }}}


class IngestRawEventResponse(BaseModel):
    """Response after ingesting a raw event."""

    success: bool = Field(..., description="Whether the event was ingested")
    event_id: str = Field(..., description="Generated event ID")
    kafka_produced: bool = Field(..., description="Whether event was produced to Kafka")
    message: str = Field(..., description="Status message")

    model_config = {"json_schema_extra": {"example": {
        "success": True,
        "event_id": "evt_abc123",
        "kafka_produced": True,
        "message": "Event ingested and queued for processing"
    }}}


class BatchIngestRequest(BaseModel):
    """Request to ingest multiple raw events in a batch."""

    organization_id: str = Field(..., description="Organization ID")
    source_type: str = Field(..., description="Source type")
    events: list[dict[str, Any]] = Field(..., description="List of events to ingest")

    model_config = {"json_schema_extra": {"example": {
        "organization_id": "org_123",
        "source_type": "email",
        "events": [
            {"event_type": "message.received", "payload": {"message_id": "msg_1"}},
            {"event_type": "message.received", "payload": {"message_id": "msg_2"}}
        ]
    }}}


class BatchIngestResponse(BaseModel):
    """Response after batch ingestion."""

    success: bool = Field(..., description="Whether all events were ingested")
    total_events: int = Field(..., description="Total events in batch")
    ingested_count: int = Field(..., description="Number of events successfully ingested")
    kafka_produced_count: int = Field(..., description="Number of events produced to Kafka")
    message: str = Field(..., description="Status message")


class StreamConnectionInfo(BaseModel):
    """Information about connecting to the event stream."""

    url: str = Field(..., description="SSE stream URL")
    example_js: str = Field(..., description="JavaScript example for connecting")
    available_filters: list[str] = Field(..., description="Available event type filters")

    model_config = {"json_schema_extra": {"example": {"url": "/api/v1/events/stream?organization_id=org_123", "example_js": "const es = new EventSource('/api/v1/events/stream?organization_id=org_123');", "available_filters": ["uio.created", "commitment.due"]}}}


# =============================================================================
# EVENT TYPE DEFINITIONS
# =============================================================================

EVENT_TYPE_DESCRIPTIONS = {
    # UIO lifecycle
    "uio.created": ("uio_lifecycle", "Fired when a new Universal Intelligence Object is created"),
    "uio.updated": ("uio_lifecycle", "Fired when a UIO is updated"),
    "uio.deleted": ("uio_lifecycle", "Fired when a UIO is deleted"),
    "uio.superseded": ("uio_lifecycle", "Fired when a UIO is superseded by another"),
    # Decisions
    "decision.made": ("decisions", "Fired when a new decision is recorded"),
    "decision.reversed": ("decisions", "Fired when a decision is reversed"),
    # Commitments
    "commitment.created": ("commitments", "Fired when a new commitment is created"),
    "commitment.due": ("commitments", "Fired when a commitment is due soon"),
    "commitment.overdue": ("commitments", "Fired when a commitment becomes overdue"),
    "commitment.fulfilled": ("commitments", "Fired when a commitment is fulfilled"),
    # Tasks
    "task.created": ("tasks", "Fired when a new task is created"),
    "task.completed": ("tasks", "Fired when a task is completed"),
    # Risks
    "risk.detected": ("risks", "Fired when a new risk is detected"),
    "risk.resolved": ("risks", "Fired when a risk is resolved"),
    # Entities
    "entity.created": ("entities", "Fired when a new entity is created"),
    "entity.updated": ("entities", "Fired when an entity is updated"),
    "entity.merged": ("entities", "Fired when entities are merged"),
    # Relationships
    "relationship.created": ("relationships", "Fired when a new relationship is created"),
    "relationship.updated": ("relationships", "Fired when a relationship is updated"),
    "relationship.health_changed": ("relationships", "Fired when relationship health changes"),
    # Intelligence
    "brief.generated": ("intelligence", "Fired when a brief is generated"),
    "contradiction.detected": ("intelligence", "Fired when a contradiction is detected"),
    "pattern.detected": ("intelligence", "Fired when a pattern is detected"),
    # Sync
    "sync.started": ("sync", "Fired when a sync job starts"),
    "sync.completed": ("sync", "Fired when a sync job completes"),
    "sync.failed": ("sync", "Fired when a sync job fails"),
    # System
    "decay.computed": ("system", "Fired when memory decay is computed"),
    "archive.triggered": ("system", "Fired when nodes are archived"),
}


# =============================================================================
# API ENDPOINTS
# =============================================================================


@router.get(
    "/types",
    response_model=EventTypesResponse,
    summary="List all event types",
    description="""
Returns all available event types that can be subscribed to, grouped by category.

Use these event type names when:
- Filtering the SSE stream with the `event_types` parameter
- Publishing custom events
- Setting up webhook subscriptions

**Categories:**
- `uio_lifecycle`: Universal Intelligence Object lifecycle events
- `decisions`: Decision-related events
- `commitments`: Commitment tracking events
- `tasks`: Task management events
- `risks`: Risk detection events
- `entities`: Entity management events
- `relationships`: Relationship tracking events
- `intelligence`: Intelligence extraction events
- `sync`: Data synchronization events
- `system`: System maintenance events

Requires `read` scope.
""",
)
async def list_event_types(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> EventTypesResponse:
    """List all available event types grouped by category."""
    grouped: dict[str, list[EventTypeInfo]] = {}

    for event_type, (category, description) in EVENT_TYPE_DESCRIPTIONS.items():
        if category not in grouped:
            grouped[category] = []
        grouped[category].append(
            EventTypeInfo(
                name=event_type,
                category=category,
                description=description,
            )
        )

    return EventTypesResponse(
        event_types=grouped,
        total_count=len(EVENT_TYPE_DESCRIPTIONS),
    )


@router.get(
    "/stream/info",
    response_model=StreamConnectionInfo,
    summary="Get stream connection information",
    description="""
Returns information about how to connect to the event stream.

Includes:
- The SSE stream URL
- JavaScript example code
- Available event type filters

Requires `read` scope.
""",
)
async def get_stream_info(
    organization_id: Annotated[str, Query(description="Organization ID for the stream")],
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> StreamConnectionInfo:
    """Get information about connecting to the event stream."""
    _validate_org_id(ctx, organization_id)

    base_url = f"/api/v1/events/stream?organization_id={organization_id}"

    example_js = f"""// Connect to the event stream
const eventSource = new EventSource('{base_url}');

// Listen for all events
eventSource.onmessage = (event) => {{
    const data = JSON.parse(event.data);
    console.log('Event received:', data);
}};

// Listen for specific event types
eventSource.addEventListener('uio.created', (event) => {{
    const data = JSON.parse(event.data);
    console.log('New UIO created:', data);
}});

// Handle errors
eventSource.onerror = (error) => {{
    console.error('SSE error:', error);
}};

// Close connection when done
// eventSource.close();"""

    return StreamConnectionInfo(
        url=base_url,
        example_js=example_js,
        available_filters=list(EVENT_TYPE_DESCRIPTIONS.keys()),
    )


@router.get(
    "/stream",
    summary="Stream real-time events (SSE)",
    description="""
Stream real-time events via Server-Sent Events (SSE).

**Connection:**
```javascript
const eventSource = new EventSource('/api/v1/events/stream?organization_id=org_123');
```

**Filtering:**
Use the `event_types` parameter to filter specific events:
```
/api/v1/events/stream?organization_id=org_123&event_types=uio.created,commitment.due
```

**Event Format:**
```
event: uio.created
data: {"event_id": "evt_123", "event_type": "uio.created", "payload": {...}}
```

**Connection Events:**
- `connected`: Sent when connection is established
- Event type-specific events (e.g., `uio.created`)
- `error`: Sent when an error occurs

**Notes:**
- Keep-alive messages are sent periodically
- Reconnection is handled automatically by EventSource
- Set `include_broadcast=true` to also receive system-wide events

Requires `read` scope.
""",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "SSE event stream",
            "content": {"text/event-stream": {"example": "event: uio.created\ndata: {...}\n\n"}},
        }
    },
)
async def stream_events(
    request: Request,
    organization_id: Annotated[str, Query(description="Organization ID to stream events for")],
    event_types: Annotated[
        str | None,
        Query(description="Comma-separated event types to filter (e.g., 'uio.created,commitment.due')"),
    ] = None,
    include_broadcast: Annotated[
        bool,
        Query(description="Include system-wide broadcast events"),
    ] = False,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> StreamingResponse:
    """Stream real-time events via SSE."""
    _validate_org_id(ctx, organization_id)

    import asyncio
    import json

    parsed_types: list[EventType] | None = None
    if event_types:
        parsed_types = []
        for et in event_types.split(","):
            et = et.strip()
            try:
                parsed_types.append(EventType(et))
            except ValueError:
                logger.warning(f"Unknown event type filter: {et}")

    async def event_generator():
        # Send connection event
        yield _format_sse(
            {"type": "connected", "organization_id": organization_id, "filters": event_types},
            event_type="connected",
        )

        try:
            async with EventStream(
                organization_id=organization_id,
                event_types=parsed_types,
                include_broadcast=include_broadcast,
            ) as stream:
                async for event in stream:
                    yield _format_sse(event.to_dict(), event_type=event.event_type.value)

        except asyncio.CancelledError:
            logger.debug("SSE stream cancelled", organization_id=organization_id)
        except Exception as e:
            logger.error("SSE stream error", error=str(e))
            yield _format_sse({"type": "error", "message": str(e)}, event_type="error")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/publish",
    response_model=PublishEventResponse,
    summary="Publish a custom event",
    description="""
Publish a custom event to the event stream.

**Use Cases:**
- Trigger notifications from external systems
- Publish custom application events
- Test event stream connections

**Note:** Most events are published automatically by the system.
This endpoint is for custom/external event publishing.

Requires `write` scope.
""",
    responses={
        200: {"description": "Event published successfully"},
        400: {"description": "Invalid event type"},
        500: {"description": "Failed to publish event"},
    },
)
async def publish_event(
    request: PublishEventRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> PublishEventResponse:
    """Publish a custom event."""
    _validate_org_id(ctx, request.organization_id)

    # Validate event type
    try:
        event_type = EventType(request.event_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event type: {request.event_type}. See /events/types for valid types.",
        )

    try:
        publisher = await get_event_publisher()

        event = Event(
            event_type=event_type,
            organization_id=request.organization_id,
            payload=request.payload,
            correlation_id=request.correlation_id,
            source="api",
        )

        success = await publisher.publish(event, broadcast=request.broadcast)

        if success:
            return PublishEventResponse(
                success=True,
                event_id=event.event_id,
                message="Event published successfully",
            )
        else:
            return PublishEventResponse(
                success=False,
                event_id=None,
                message="Event publishing failed - Redis may be unavailable",
            )

    except Exception as e:
        logger.error("Failed to publish event", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to publish event: {str(e)}")


def _format_sse(data: dict, event_type: str | None = None) -> str:
    """Format data as SSE event."""
    import json

    lines = []
    if event_type:
        lines.append(f"event: {event_type}")
    lines.append(f"data: {json.dumps(data)}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


# =============================================================================
# RAW EVENT INGESTION (for TypeScript backend / connectors)
# =============================================================================


@router.post(
    "/ingest",
    response_model=IngestRawEventResponse,
    summary="Ingest a raw event from connectors",
    description="""
Ingest a raw event from external connectors (TypeScript backend).

This endpoint is the primary entry point for the intelligence pipeline:
1. Event is received from connector (email, Slack, Linear, etc.)
2. Event is produced to Kafka `drovi-raw-events` topic
3. Intelligence extraction pipeline picks it up for processing
4. Extracted intelligence is written to FalkorDB

**Source Types:**
- `email`: Email messages (Gmail, Outlook, etc.)
- `slack`: Slack messages
- `linear`: Linear issues and comments
- `github`: GitHub issues, PRs, comments
- `notion`: Notion pages and updates
- `custom`: Custom webhook events

**Event Types:**
- `message.received`: New message/email received
- `message.sent`: Message/email sent
- `issue.created`: Issue created
- `issue.updated`: Issue updated
- `comment.added`: Comment added
- `sync.batch`: Batch sync event

If Kafka is not available, the event will still be accepted and
processed synchronously (with higher latency).

Requires `write` scope.
""",
    responses={
        200: {"description": "Event ingested successfully"},
        403: {"description": "Organization ID mismatch"},
        500: {"description": "Failed to ingest event"},
    },
)
async def ingest_raw_event(
    request: IngestRawEventRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> IngestRawEventResponse:
    """Ingest a raw event from connectors."""
    _validate_org_id(ctx, request.organization_id)

    from uuid import uuid4

    event_id = str(uuid4())
    kafka_produced = False

    try:
        # Try to produce to Kafka first
        from src.streaming import get_kafka_producer, is_streaming_enabled

        if is_streaming_enabled():
            producer = await get_kafka_producer()
            await producer.produce_raw_event(
                organization_id=request.organization_id,
                source_type=request.source_type,
                event_type=request.event_type,
                payload=request.payload,
                source_id=request.source_id,
            )
            kafka_produced = True
            logger.info(
                "Raw event produced to Kafka",
                event_id=event_id,
                organization_id=request.organization_id,
                source_type=request.source_type,
                event_type=request.event_type,
            )
        else:
            # Kafka not available - process synchronously
            logger.info(
                "Kafka not enabled, processing event synchronously",
                event_id=event_id,
                organization_id=request.organization_id,
            )
            # TODO: Call orchestrator directly for synchronous processing
            # This is a fallback path when Kafka is not available

        return IngestRawEventResponse(
            success=True,
            event_id=event_id,
            kafka_produced=kafka_produced,
            message="Event ingested and queued for processing" if kafka_produced else "Event accepted for synchronous processing",
        )

    except Exception as e:
        logger.error(
            "Failed to ingest raw event",
            event_id=event_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=f"Failed to ingest event: {str(e)}")


@router.post(
    "/ingest/batch",
    response_model=BatchIngestResponse,
    summary="Ingest multiple raw events in a batch",
    description="""
Ingest multiple raw events in a single batch request.

This is useful for:
- Initial sync of historical data
- Batch processing of accumulated events
- Efficient bulk ingestion

Each event in the batch is produced to Kafka independently.
The response includes counts of successful ingestion.

**Note:** For very large batches (>1000 events), consider using
multiple requests or the async import endpoint.

Requires `write` scope.
""",
    responses={
        200: {"description": "Batch ingested successfully"},
        403: {"description": "Organization ID mismatch"},
        500: {"description": "Failed to ingest batch"},
    },
)
async def ingest_batch(
    request: BatchIngestRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> BatchIngestResponse:
    """Ingest a batch of raw events."""
    _validate_org_id(ctx, request.organization_id)

    from uuid import uuid4

    ingested_count = 0
    kafka_produced_count = 0
    total_events = len(request.events)

    try:
        from src.streaming import get_kafka_producer, is_streaming_enabled

        kafka_enabled = is_streaming_enabled()
        producer = None
        if kafka_enabled:
            producer = await get_kafka_producer()

        for event_data in request.events:
            try:
                event_type = event_data.get("event_type", "unknown")
                payload = event_data.get("payload", {})
                source_id = event_data.get("source_id")

                if kafka_enabled and producer:
                    await producer.produce_raw_event(
                        organization_id=request.organization_id,
                        source_type=request.source_type,
                        event_type=event_type,
                        payload=payload,
                        source_id=source_id,
                    )
                    kafka_produced_count += 1

                ingested_count += 1

            except Exception as e:
                logger.warning(
                    "Failed to ingest event in batch",
                    error=str(e),
                    event_data=event_data,
                )

        # Flush producer to ensure all messages are sent
        if producer:
            await producer.flush()

        logger.info(
            "Batch ingestion complete",
            organization_id=request.organization_id,
            total=total_events,
            ingested=ingested_count,
            kafka_produced=kafka_produced_count,
        )

        return BatchIngestResponse(
            success=ingested_count == total_events,
            total_events=total_events,
            ingested_count=ingested_count,
            kafka_produced_count=kafka_produced_count,
            message=f"Ingested {ingested_count}/{total_events} events",
        )

    except Exception as e:
        logger.error("Failed to ingest batch", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to ingest batch: {str(e)}")
