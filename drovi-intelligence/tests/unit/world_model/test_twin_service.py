from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from src.world_model.twin import EntityTwinState, WorldTwinSnapshot
from src.world_model.twin_service import (
    WorldTwinService,
    run_twin_diff_benchmark,
    run_twin_refresh_benchmark,
)


@pytest.mark.asyncio
async def test_build_snapshot_returns_role_view_pressure_and_drift() -> None:
    service = WorldTwinService(organization_id="org_1")
    service._load_internal_objects = AsyncMock(  # type: ignore[method-assign]
        return_value=[{"id": "obj_1", "type": "commitment", "entity_refs": ["acme"]}]
    )
    service._load_external_events = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            {
                "event_id": "ev_1",
                "source": "worldnews",
                "observed_at": datetime(2026, 2, 23, 12, 0, tzinfo=UTC),
                "domain": "legal",
                "reliability": 0.9,
                "entity_refs": ["acme"],
            }
        ]
    )
    service._belief_drift_radar = AsyncMock(return_value={"revision_count": 2})  # type: ignore[method-assign]
    service._load_latest_snapshot = AsyncMock(return_value=None)  # type: ignore[method-assign]
    service._persist_snapshot = AsyncMock()  # type: ignore[method-assign]
    service._persist_drift_event = AsyncMock()  # type: ignore[method-assign]

    result = await service.build_snapshot(
        lookback_hours=24,
        role="legal",
        persist=True,
    )

    assert result["snapshot_id"]
    assert result["pressure_map"]["top_entities"][0]["entity_id"] == "acme"
    assert result["role_view"]["role"] == "legal"
    assert result["belief_drift_radar"]["revision_count"] == 2
    assert service._persist_snapshot.await_count == 1


@pytest.mark.asyncio
async def test_apply_stream_event_updates_snapshot_incrementally() -> None:
    service = WorldTwinService(organization_id="org_1")
    service._load_latest_snapshot = AsyncMock(  # type: ignore[method-assign]
        return_value=WorldTwinSnapshot(
            organization_id="org_1",
            snapshot_at=datetime(2026, 2, 23, 10, 0, tzinfo=UTC),
            entity_states={
                "acme": EntityTwinState(
                    entity_id="acme",
                    internal_refs=["obj_1"],
                    external_refs=["ev_0"],
                    pressure_score=0.4,
                    tags=["legal"],
                )
            },
            domain_pressure={"legal": 0.4},
            internal_object_count=1,
            external_event_count=1,
        )
    )
    service._persist_snapshot = AsyncMock()  # type: ignore[method-assign]
    service._persist_drift_event = AsyncMock()  # type: ignore[method-assign]

    result = await service.apply_stream_event(
        event={
            "event_id": "ev_1",
            "source": "worldnews",
            "observed_at": datetime(2026, 2, 23, 12, 0, tzinfo=UTC),
            "domain": "legal",
            "reliability": 0.8,
            "entity_refs": ["acme"],
        },
        persist=True,
    )

    assert result["snapshot"]["external_event_count"] == 2
    assert result["snapshot"]["domain_pressure"]["legal"] > 0.4
    assert result["drift_metrics"]["drift_index"] > 0.0
    assert service._persist_snapshot.await_count == 1


def test_run_twin_diff_benchmark_passes_seeded_case() -> None:
    result = run_twin_diff_benchmark()

    assert result["benchmark"] == "world-twin-diff-v1"
    assert result["accuracy"] == 1.0
    assert result["passed"] is True


def test_run_twin_refresh_benchmark_meets_default_target() -> None:
    result = run_twin_refresh_benchmark()

    assert result["benchmark"] == "world-twin-refresh-latency-v1"
    assert result["target_latency_ms"] == 1000
    assert result["passed"] is True


@pytest.mark.asyncio
async def test_get_latest_snapshot_prefers_hot_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    service = WorldTwinService(organization_id="org_1")
    cached_payload = {
        "snapshot_id": "snap_cached",
        "snapshot": {"organization_id": "org_1", "entity_states": {}, "domain_pressure": {}},
        "role_view": {"role": "exec"},
    }
    service._cache_set("latest:exec", cached_payload)

    async def _fail_get_checkpoint(**kwargs):  # noqa: ANN003
        raise AssertionError("checkpoint lookup should not be called when cache is hot")

    monkeypatch.setattr("src.world_model.twin_service.get_checkpoint", _fail_get_checkpoint)
    payload = await service.get_latest_snapshot(role="exec")
    assert payload is not None
    assert payload["snapshot_id"] == "snap_cached"


@pytest.mark.asyncio
async def test_pre_materialize_hot_queries_builds_snapshots_for_roles_and_horizons() -> None:
    service = WorldTwinService(organization_id="org_1")
    build_snapshot = AsyncMock(return_value={"snapshot_id": "snap_x"})
    service.build_snapshot = build_snapshot  # type: ignore[assignment]

    result = await service.pre_materialize_hot_queries(
        roles=["exec", "finance"],
        lookback_hours=[24, 168],
    )

    assert result["built_snapshots"] == 4
    assert build_snapshot.await_count == 4
