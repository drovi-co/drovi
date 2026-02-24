from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.ingestion.observation_store import persist_normalized_observation


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeConn:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    async def execute(self, query, *args):  # type: ignore[no-untyped-def]
        self.executed.append((str(query), args))
        return "OK"


class _Acquire:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeConn:
        return self._conn

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class _Pool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self) -> _Acquire:
        return _Acquire(self._conn)


async def test_persist_normalized_observation_writes_db_and_lakehouse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_conn = _FakeConn()
    write_mock = AsyncMock(return_value=SimpleNamespace(accepted=True))
    settings = SimpleNamespace(
        retention_raw_observation_days=3650,
        retention_normalized_observation_days=1825,
        retention_derived_feature_days=1095,
    )
    monkeypatch.setattr("src.ingestion.observation_store.get_db_pool", AsyncMock(return_value=_Pool(fake_conn)))
    monkeypatch.setattr("src.ingestion.observation_store.write_lake_record", write_mock)
    monkeypatch.setattr("src.ingestion.retention.get_settings", lambda: settings)

    result = await persist_normalized_observation(
        organization_id="org_test",
        normalized_id="norm_1",
        source_type="news_api",
        source_id="article_1",
        event_type="connector.record",
        normalized_payload={
            "content": "Headline: Markets move",
            "subject": "Markets move",
            "conversation_id": None,
            "user_email": None,
            "user_name": None,
            "metadata": {
                "world_observation_raw": {
                    "observation_id": "obs_1",
                    "artifact_id": "obsraw_1",
                    "artifact_sha256": "abc123",
                    "artifact_storage_path": "/tmp/raw.json",
                    "trace_id": "trace_1",
                    "ingest_run_id": "run_1",
                },
                "world_canonical": {"family": "news", "entities": ["ACME"]},
            },
        },
        ingest={
            "origin_ts": "2026-02-23T10:00:00+00:00",
            "source_fingerprint": "fp_1",
            "trace_id": "trace_1",
        },
    )

    assert result.observation_id == "obs_1"
    assert result.persisted_db is True
    assert result.persisted_lakehouse is True
    assert result.evidence_linked is True
    assert len(fake_conn.executed) >= 2
    assert write_mock.await_count == 1
