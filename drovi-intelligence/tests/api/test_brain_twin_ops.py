from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeTwinService:
    def __init__(self) -> None:
        self.build_snapshot = AsyncMock(
            return_value={
                "snapshot_id": "snap_1",
                "snapshot_at": "2026-02-23T12:00:00+00:00",
                "snapshot": {"organization_id": "org_test"},
                "drift_metrics": {"drift_index": 0.4},
            }
        )
        self.apply_stream_event = AsyncMock(return_value={"snapshot_id": "snap_2"})
        self.get_latest_snapshot = AsyncMock(
            return_value={
                "snapshot_id": "snap_1",
                "snapshot_at": "2026-02-23T12:00:00+00:00",
                "snapshot": {"organization_id": "org_test"},
            }
        )
        self.get_snapshot_history = AsyncMock(
            return_value=[{"snapshot_id": "snap_1", "snapshot_at": "2026-02-23T12:00:00+00:00"}]
        )
        self.diff = AsyncMock(
            return_value={
                "from_snapshot_id": "snap_0",
                "to_snapshot_id": "snap_1",
                "deltas": [{"delta_type": "entity_pressure", "ref": "acme"}],
                "drift_metrics": {"drift_index": 0.5},
            }
        )
        self.get_pressure_map = AsyncMock(return_value={"top_entities": [{"entity_id": "acme"}]})
        self.get_belief_drift_radar = AsyncMock(return_value={"revision_count": 4})
        self.explain = AsyncMock(return_value={"entity_id": "acme", "found": True})


async def test_brain_twin_build_and_read_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeTwinService()
    monkeypatch.setattr("src.api.routes.brain.record_audit_event", AsyncMock())
    monkeypatch.setattr(
        "src.api.routes.brain.get_world_twin_service",
        AsyncMock(return_value=service),
    )

    build_response = await async_client.post(
        "/api/v1/brain/twin/build",
        json={"organization_id": "org_test", "role": "exec", "persist": True, "enqueue": False},
    )
    assert build_response.status_code == 200
    assert build_response.json()["result"]["snapshot_id"] == "snap_1"
    assert build_response.json()["explainability"]["output_type"] == "world_twin_snapshot"

    twin_response = await async_client.get("/api/v1/brain/twin?organization_id=org_test")
    assert twin_response.status_code == 200
    assert twin_response.json()["snapshot"]["snapshot_id"] == "snap_1"

    history_response = await async_client.get("/api/v1/brain/twin/history?organization_id=org_test")
    assert history_response.status_code == 200
    assert history_response.json()["count"] == 1

    diff_response = await async_client.get("/api/v1/brain/twin/diff?organization_id=org_test")
    assert diff_response.status_code == 200
    assert diff_response.json()["diff"]["drift_metrics"]["drift_index"] == 0.5

    pressure_response = await async_client.get("/api/v1/brain/twin/pressure-map?organization_id=org_test")
    assert pressure_response.status_code == 200
    assert pressure_response.json()["pressure_map"]["top_entities"][0]["entity_id"] == "acme"

    drift_radar_response = await async_client.get(
        "/api/v1/brain/twin/belief-drift-radar?organization_id=org_test"
    )
    assert drift_radar_response.status_code == 200
    assert drift_radar_response.json()["belief_drift_radar"]["revision_count"] == 4

    explain_response = await async_client.get(
        "/api/v1/brain/twin/explainability?organization_id=org_test&entity_id=acme"
    )
    assert explain_response.status_code == 200
    assert explain_response.json()["explanation"]["found"] is True
    assert explain_response.json()["explainability"]["output_type"] == "world_twin_explanation"


async def test_brain_twin_enqueue_stream_update_and_benchmark(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeTwinService()
    enqueue_job_mock = AsyncMock(return_value="job_twin_1")
    monkeypatch.setattr(
        "src.api.routes.brain.get_world_twin_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.record_audit_event", AsyncMock())
    monkeypatch.setattr("src.api.routes.brain.enqueue_job", enqueue_job_mock)
    monkeypatch.setattr(
        "src.api.routes.brain.run_twin_diff_benchmark",
        lambda: {"benchmark": "world-twin-diff-v1", "accuracy": 1.0, "passed": True},
    )
    monkeypatch.setattr(
        "src.api.routes.brain.run_twin_refresh_benchmark",
        lambda **_kwargs: {"benchmark": "world-twin-refresh-latency-v1", "latency_ms": 12, "passed": True},
    )

    enqueue_build = await async_client.post(
        "/api/v1/brain/twin/build",
        json={"organization_id": "org_test", "enqueue": True},
    )
    assert enqueue_build.status_code == 200
    assert enqueue_build.json()["enqueued"] is True
    assert enqueue_build.json()["job_id"] == "job_twin_1"

    stream_inline = await async_client.post(
        "/api/v1/brain/twin/stream-update",
        json={
            "organization_id": "org_test",
            "enqueue": False,
            "event": {"event_id": "ev_1", "source": "worldnews", "entity_refs": ["acme"]},
        },
    )
    assert stream_inline.status_code == 200
    assert stream_inline.json()["result"]["snapshot_id"] == "snap_2"
    assert stream_inline.json()["explainability"]["output_type"] == "world_twin_stream_update"

    stream_enqueue = await async_client.post(
        "/api/v1/brain/twin/stream-update",
        json={
            "organization_id": "org_test",
            "enqueue": True,
            "event": {"event_id": "ev_1", "source": "worldnews", "entity_refs": ["acme"]},
        },
    )
    assert stream_enqueue.status_code == 200
    assert stream_enqueue.json()["enqueued"] is True

    benchmark_response = await async_client.get("/api/v1/brain/twin/benchmark?organization_id=org_test")
    assert benchmark_response.status_code == 200
    assert benchmark_response.json()["benchmark"]["passed"] is True
