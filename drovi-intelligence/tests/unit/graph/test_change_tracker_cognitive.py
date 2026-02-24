from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from src.graph.changes.diff import compute_diff
from src.graph.changes.tracker import ChangeRecord, ChangeTracker


class _FakeVersionManager:
    async def get_latest_version(self, _entity_id: str, _entity_type: str):
        return None

    async def save_version(
        self,
        *,
        entity_id: str,
        entity_type: str,
        data: dict,
        created_by: str | None,
        change_reason: str | None,
    ):
        return SimpleNamespace(
            entity_id=entity_id,
            entity_type=entity_type,
            version=1,
            data=data,
            created_at=datetime(2026, 2, 23, 10, 0, tzinfo=UTC),
            created_by=created_by,
            change_reason=change_reason,
        )


@pytest.mark.asyncio
async def test_track_cognitive_change_sets_layer_metadata() -> None:
    tracker = ChangeTracker()
    tracker._version_manager = _FakeVersionManager()

    record = await tracker.track_cognitive_change(
        entity_id="belief_1",
        entity_type="belief",
        cognitive_layer="epistemics",
        new_data={"probability": 0.73},
        changed_by="system",
        change_reason="belief updated",
        trace_id="trace_1",
        confidence=0.88,
    )

    assert record.cognitive_layer == "epistemics"
    assert record.trace_id == "trace_1"
    assert record.confidence == 0.88
    assert record.diff is not None


@pytest.mark.asyncio
async def test_get_cognitive_changes_since_filters_by_layer(monkeypatch) -> None:
    tracker = ChangeTracker()

    diff = compute_diff(
        old_data={"probability": 0.4},
        new_data={"probability": 0.6, "_cognitive_layer": "causal", "_trace_id": "trace_a"},
        entity_id="belief_2",
        entity_type="belief",
        old_version=1,
        new_version=2,
    )
    record = ChangeRecord(
        entity_id="belief_2",
        entity_type="belief",
        change_type="updated",
        version=2,
        diff=diff,
        timestamp=datetime(2026, 2, 23, 11, 0, tzinfo=UTC),
    )

    async def _fake_get_changes_since(*_args, **_kwargs):
        return [record]

    monkeypatch.setattr(tracker, "get_changes_since", _fake_get_changes_since)

    filtered = await tracker.get_cognitive_changes_since(
        organization_id="org_1",
        since=datetime(2026, 2, 22, 0, 0, tzinfo=UTC),
        cognitive_layer="causal",
        limit=10,
    )

    assert len(filtered) == 1
    assert filtered[0].cognitive_layer == "causal"
    assert filtered[0].trace_id == "trace_a"
