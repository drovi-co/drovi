from __future__ import annotations

import pytest

from src.streaming.processing_tier import StreamProcessingTier

pytestmark = [pytest.mark.unit]


def test_processing_tier_routes_critical_priority_to_critical_pool() -> None:
    decision = StreamProcessingTier().route(
        topic="raw.connector.events",
        payload={"priority": 1, "source_type": "worldnewsapi"},
        backlog_depth=20,
    )
    assert decision.worker_pool == "stream-critical"


def test_processing_tier_routes_world_sources_to_high_volume_pool() -> None:
    decision = StreamProcessingTier().route(
        topic="raw.connector.events",
        payload={"priority": 5, "source_type": "worldnewsapi"},
        backlog_depth=6000,
    )
    assert decision.worker_pool == "stream-high-volume"
    assert decision.max_concurrency >= 32


def test_processing_tier_routes_default_to_standard_pool() -> None:
    decision = StreamProcessingTier().route(
        topic="normalized.records",
        payload={"priority": 5, "source_type": "email"},
        backlog_depth=10,
    )
    assert decision.worker_pool == "stream-standard"
