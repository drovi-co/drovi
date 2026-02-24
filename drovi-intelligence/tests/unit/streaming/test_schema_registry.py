from __future__ import annotations

import pytest

from src.streaming.schema_registry import SchemaRegistry

pytestmark = [pytest.mark.unit]


def test_schema_registry_register_and_validate_required_fields() -> None:
    registry = SchemaRegistry()
    registry.register(
        subject="event.alpha.v1",
        schema={
            "type": "object",
            "properties": {"event_id": {"type": "string"}, "payload": {"type": "object"}},
            "required": ["event_id", "payload"],
        },
    )

    registry.validate_payload_shape(
        subject="event.alpha.v1",
        payload={"event_id": "evt-1", "payload": {}},
    )

    with pytest.raises(ValueError):
        registry.validate_payload_shape(subject="event.alpha.v1", payload={"event_id": "evt-2"})


def test_schema_registry_blocks_backward_incompatible_changes() -> None:
    registry = SchemaRegistry()
    registry.register(
        subject="event.beta.v1",
        schema={
            "type": "object",
            "properties": {"id": {"type": "string"}, "payload": {"type": "object"}},
            "required": ["id"],
        },
    )

    with pytest.raises(ValueError):
        registry.register(
            subject="event.beta.v1",
            schema={
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
            compatibility="backward",
        )
