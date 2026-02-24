from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.lakehouse.jobs import run_lakehouse_quality, run_lakehouse_replay

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_lakehouse_replay_writes_from_event_records(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Acquire:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def fetch(self, *args, **kwargs):
            return [
                {
                    "id": "evt_1",
                    "organization_id": "org_test",
                    "event_type": "observation.normalized.v1",
                    "payload": {
                        "observation_id": "obs_1",
                        "normalized_text": "text",
                        "entities": [],
                    },
                    "created_at": datetime(2026, 2, 23, 10, 0, tzinfo=timezone.utc),
                }
            ]

    class _Pool:
        def acquire(self):
            return _Acquire()

    monkeypatch.setattr("src.lakehouse.jobs.get_db_pool", AsyncMock(return_value=_Pool()))
    monkeypatch.setattr("src.lakehouse.jobs.get_checkpoint", AsyncMock(return_value=None))
    monkeypatch.setattr("src.lakehouse.jobs.upsert_checkpoint", AsyncMock())
    write_mock = AsyncMock(return_value=type("Result", (), {"accepted": True})())
    monkeypatch.setattr("src.lakehouse.jobs.write_lake_record", write_mock)

    result = await run_lakehouse_replay(
        organization_id="org_test",
        checkpoint_key="replay:test",
        max_events=100,
    )

    assert result["replayed_events"] == 1
    assert result["silver_written"] == 1
    assert write_mock.await_count == 1


async def test_lakehouse_quality_marks_failed_partitions_as_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.lakehouse.jobs.list_partitions",
        AsyncMock(
            return_value=[
                {
                    "table_name": "silver.observations",
                    "partition_key": "date=2026-02-23",
                    "partition_path": "/tmp/nonexistent.jsonl",
                }
            ]
        ),
    )
    monkeypatch.setattr(
        "src.lakehouse.jobs.evaluate_and_gate_partition",
        AsyncMock(return_value={"status": "failed"}),
    )

    result = await run_lakehouse_quality(
        organization_id="org_test",
        table_name="silver.observations",
        limit=10,
    )

    assert result["checked"] == 1
    assert result["blocked"] == 1
