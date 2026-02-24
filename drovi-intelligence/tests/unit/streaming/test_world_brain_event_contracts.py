from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from src.streaming.world_brain_event_contracts import (
    WORLD_BRAIN_EVENT_MODELS,
    validate_world_brain_event,
)


def test_world_brain_event_contract_catalog_is_complete() -> None:
    assert set(WORLD_BRAIN_EVENT_MODELS) == {
        "observation.raw.v1",
        "observation.normalized.v1",
        "belief.update.v1",
        "belief.degraded.v1",
        "hypothesis.generated.v1",
        "hypothesis.rejected.v1",
        "causal.edge.update.v1",
        "impact.edge.computed.v1",
        "constraint.violation.candidate.v1",
        "simulation.requested.v1",
        "simulation.completed.v1",
        "intervention.proposed.v1",
        "outcome.realized.v1",
    }


def test_validate_world_brain_event_accepts_valid_payload() -> None:
    event = validate_world_brain_event(
        "belief.update.v1",
        {
            "schema_version": "1.0",
            "organization_id": "org-1",
            "event_id": "evt-1",
            "occurred_at": datetime(2026, 2, 22, 8, 0, 0, tzinfo=timezone.utc),
            "producer": "drovi-intelligence",
            "event_type": "belief.update.v1",
            "payload": {
                "belief_id": "belief-1",
                "proposition": "Fed policy will remain restrictive",
                "next_state": "asserted",
                "probability": 0.72,
                "supporting_observation_ids": ["obs-1", "obs-2"],
                "revised_at": datetime(2026, 2, 22, 8, 0, 0, tzinfo=timezone.utc),
            },
        },
    )

    assert event.event_type == "belief.update.v1"
    assert event.payload.probability == 0.72


def test_validate_world_brain_event_rejects_invalid_payload() -> None:
    with pytest.raises(ValidationError):
        validate_world_brain_event(
            "belief.update.v1",
            {
                "schema_version": "1.0",
                "organization_id": "org-1",
                "event_id": "evt-1",
                "occurred_at": datetime(2026, 2, 22, 8, 0, 0, tzinfo=timezone.utc),
                "event_type": "belief.update.v1",
                "payload": {
                    "belief_id": "belief-1",
                    "proposition": "missing probability and revised_at",
                    "next_state": "asserted",
                },
            },
        )


def test_validate_world_brain_event_rejects_unknown_event_type() -> None:
    with pytest.raises(ValueError):
        validate_world_brain_event(
            "belief.update.v999",
            {
                "event_type": "belief.update.v999",
                "payload": {},
            },
        )
