"""
Server-Sent Events (SSE) Integration

Provides FastAPI endpoints for real-time event streaming via SSE.
"""

from collections.abc import AsyncIterator
from typing import Any
import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
import structlog

from src.events.types import Event, EventType
from src.events.subscriber import EventStream

logger = structlog.get_logger()

router = APIRouter(prefix="/events", tags=["events"])


async def _event_generator(
    organization_id: str,
    event_types: list[str] | None = None,
    include_broadcast: bool = False,
) -> AsyncIterator[str]:
    """
    Generate SSE events for a client connection.

    Yields SSE-formatted event strings.
    """
    # Parse event types
    parsed_types: list[EventType] | None = None
    if event_types:
        parsed_types = []
        for et in event_types:
            try:
                parsed_types.append(EventType(et))
            except ValueError:
                logger.warning(f"Unknown event type: {et}")

    # Send initial connection event
    yield _format_sse_event({
        "type": "connected",
        "organization_id": organization_id,
        "subscribed_types": event_types or ["*"],
    })

    try:
        async with EventStream(
            organization_id=organization_id,
            event_types=parsed_types,
            include_broadcast=include_broadcast,
        ) as stream:
            async for event in stream:
                yield _format_sse_event(event.to_dict(), event_type=event.event_type.value)

    except asyncio.CancelledError:
        logger.debug("SSE connection cancelled", organization_id=organization_id)
    except Exception as e:
        logger.error("SSE stream error", error=str(e))
        yield _format_sse_event({"type": "error", "message": str(e)})


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
    lines.append("")  # Empty line to end the event
    lines.append("")  # Extra empty line for separation
    return "\n".join(lines)


@router.get("/stream")
async def stream_events(
    request: Request,
    organization_id: str = Query(..., description="Organization ID to stream events for"),
    event_types: str | None = Query(
        None,
        description="Comma-separated list of event types to filter (e.g., 'uio.created,commitment.due')",
    ),
    include_broadcast: bool = Query(
        False,
        description="Include system-wide broadcast events",
    ),
) -> StreamingResponse:
    """
    Stream real-time events via Server-Sent Events (SSE).

    This endpoint provides a live stream of events for the specified organization.
    Connect using EventSource in the browser:

    ```javascript
    const eventSource = new EventSource('/api/v1/events/stream?organization_id=xxx');
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Event:', data);
    };
    eventSource.addEventListener('uio.created', (event) => {
        const data = JSON.parse(event.data);
        console.log('New UIO:', data);
    });
    ```

    Available event types:
    - uio.created, uio.updated, uio.deleted, uio.superseded
    - decision.made, decision.reversed
    - commitment.created, commitment.due, commitment.overdue, commitment.fulfilled
    - task.created, task.completed
    - risk.detected, risk.resolved
    - entity.created, entity.updated, entity.merged
    - relationship.created, relationship.updated, relationship.health_changed
    - brief.generated, contradiction.detected, pattern.detected
    - sync.started, sync.completed, sync.failed
    """
    parsed_event_types = event_types.split(",") if event_types else None

    return StreamingResponse(
        _event_generator(
            organization_id=organization_id,
            event_types=parsed_event_types,
            include_broadcast=include_broadcast,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/types")
async def list_event_types() -> dict[str, Any]:
    """
    List all available event types.

    Returns a categorized list of event types that can be subscribed to.
    """
    return {
        "event_types": {
            "uio_lifecycle": [
                "uio.created",
                "uio.updated",
                "uio.deleted",
                "uio.superseded",
            ],
            "decisions": [
                "decision.made",
                "decision.reversed",
            ],
            "commitments": [
                "commitment.created",
                "commitment.due",
                "commitment.overdue",
                "commitment.fulfilled",
            ],
            "tasks": [
                "task.created",
                "task.completed",
            ],
            "risks": [
                "risk.detected",
                "risk.resolved",
            ],
            "entities": [
                "entity.created",
                "entity.updated",
                "entity.merged",
            ],
            "relationships": [
                "relationship.created",
                "relationship.updated",
                "relationship.health_changed",
            ],
            "intelligence": [
                "brief.generated",
                "contradiction.detected",
                "pattern.detected",
            ],
            "sync": [
                "sync.started",
                "sync.completed",
                "sync.failed",
            ],
            "system": [
                "decay.computed",
                "archive.triggered",
            ],
        },
    }
