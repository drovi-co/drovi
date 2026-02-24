from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.lakehouse.writer import write_lake_record

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _settings(tmp_path):
    return SimpleNamespace(
        lakehouse_storage_path=str(tmp_path / "lake"),
        lakehouse_late_arrival_grace_seconds=60,
        lakehouse_retention_days_default=365,
        lakehouse_table_format="iceberg",
    )


async def test_lake_writer_idempotent_and_upsert(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr("src.lakehouse.writer.get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr("src.lakehouse.writer.get_checkpoint", AsyncMock(return_value=None))
    monkeypatch.setattr("src.lakehouse.writer.upsert_checkpoint", AsyncMock())
    monkeypatch.setattr("src.lakehouse.writer.upsert_partition_state", AsyncMock())
    monkeypatch.setattr("src.lakehouse.writer.record_cost_attribution", AsyncMock())

    t0 = datetime(2026, 2, 23, 10, 0, tzinfo=timezone.utc)
    first = await write_lake_record(
        table_name="silver.observations",
        schema_version="1.0",
        organization_id="org_test",
        source_key="crawler",
        record_key="obs_1",
        event_time=t0,
        payload={
            "observation_id": "obs_1",
            "organization_id": "org_test",
            "source_key": "crawler",
            "observed_at": t0.isoformat(),
            "normalized_text": "initial",
        },
        idempotency_key="k1",
    )
    second = await write_lake_record(
        table_name="silver.observations",
        schema_version="1.0",
        organization_id="org_test",
        source_key="crawler",
        record_key="obs_1",
        event_time=t0,
        payload={
            "observation_id": "obs_1",
            "organization_id": "org_test",
            "source_key": "crawler",
            "observed_at": t0.isoformat(),
            "normalized_text": "initial",
        },
        idempotency_key="k1",
    )
    third = await write_lake_record(
        table_name="silver.observations",
        schema_version="1.0",
        organization_id="org_test",
        source_key="crawler",
        record_key="obs_1",
        event_time=t0 + timedelta(minutes=2),
        payload={
            "observation_id": "obs_1",
            "organization_id": "org_test",
            "source_key": "crawler",
            "observed_at": (t0 + timedelta(minutes=2)).isoformat(),
            "normalized_text": "updated",
        },
        idempotency_key="k2",
    )

    assert first.accepted is True
    assert second.accepted is False
    assert second.reason in {"duplicate_idempotency_key", "duplicate_payload"}
    assert third.accepted is True


async def test_lake_writer_flags_late_arrival(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr("src.lakehouse.writer.get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "src.lakehouse.writer.get_checkpoint",
        AsyncMock(
            return_value={
                "cursor": {
                    "max_event_time": "2026-02-23T12:00:00+00:00",
                }
            }
        ),
    )
    monkeypatch.setattr("src.lakehouse.writer.upsert_checkpoint", AsyncMock())
    monkeypatch.setattr("src.lakehouse.writer.upsert_partition_state", AsyncMock())
    monkeypatch.setattr("src.lakehouse.writer.record_cost_attribution", AsyncMock())

    late = await write_lake_record(
        table_name="bronze.raw_observations",
        schema_version="1.0",
        organization_id="org_test",
        source_key="connector",
        record_key="r1",
        event_time="2026-02-23T11:30:00+00:00",
        payload={
            "record_key": "r1",
            "organization_id": "org_test",
            "source_key": "connector",
            "event_time": "2026-02-23T11:30:00+00:00",
            "payload": {"x": 1},
        },
        idempotency_key="x1",
    )

    assert late.accepted is True
    assert late.late_arrival is True
