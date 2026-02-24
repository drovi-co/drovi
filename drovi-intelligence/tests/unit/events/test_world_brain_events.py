from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.events.publisher import EventPublisher
from src.events.subscriber import EventSubscriber
from src.events.types import (
    EventType,
    get_world_brain_event_types,
    is_world_brain_event_type,
)


def _valid_contract_event() -> dict:
    return {
        "schema_version": "1.0",
        "organization_id": "org-1",
        "event_id": "evt-1",
        "occurred_at": datetime(2026, 2, 22, 12, 0, 0, tzinfo=timezone.utc).isoformat(),
        "producer": "drovi-intelligence",
        "event_type": "belief.update.v1",
        "payload": {
            "belief_id": "belief-1",
            "proposition": "Rates stay high",
            "next_state": "asserted",
            "probability": 0.7,
            "supporting_observation_ids": ["obs-1"],
            "revised_at": datetime(2026, 2, 22, 12, 0, 0, tzinfo=timezone.utc).isoformat(),
        },
    }


def test_world_brain_event_type_helpers() -> None:
    world_brain_types = get_world_brain_event_types()
    assert EventType.BELIEF_UPDATE_V1 in world_brain_types
    assert EventType.OUTCOME_REALIZED_V1 in world_brain_types
    assert is_world_brain_event_type(EventType.BELIEF_UPDATE_V1) is True
    assert is_world_brain_event_type(EventType.UIO_CREATED) is False


@pytest.mark.asyncio
async def test_publish_world_brain_contract_event_validates_and_forwards() -> None:
    publisher = EventPublisher(persist_events=False)
    publisher.publish = AsyncMock(return_value=True)  # type: ignore[method-assign]

    result = await publisher.publish_world_brain_contract_event(_valid_contract_event())

    assert result is True
    publisher.publish.assert_awaited_once()
    published_event = publisher.publish.await_args.args[0]
    assert published_event.event_type == EventType.BELIEF_UPDATE_V1
    assert published_event.payload["event_type"] == "belief.update.v1"


@pytest.mark.asyncio
async def test_publish_world_brain_contract_event_rejects_non_world_brain_type() -> None:
    publisher = EventPublisher(persist_events=False)

    invalid = _valid_contract_event()
    invalid["event_type"] = "uio.created"

    with pytest.raises(ValueError):
        await publisher.publish_world_brain_contract_event(invalid)


@pytest.mark.asyncio
async def test_subscribe_to_world_brain_defaults_to_world_brain_types() -> None:
    subscriber = EventSubscriber()
    subscriber.subscribe_to_organization = AsyncMock()  # type: ignore[method-assign]

    await subscriber.subscribe_to_world_brain("org-1")

    subscriber.subscribe_to_organization.assert_awaited_once_with(
        "org-1",
        get_world_brain_event_types(),
    )
