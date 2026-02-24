from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.ingestion.raw_capture import persist_raw_observation_payload


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_persist_raw_observation_payload_writes_artifact_and_registers(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = SimpleNamespace(
        evidence_storage_path=str(tmp_path),
        retention_raw_observation_days=3650,
        retention_normalized_observation_days=1825,
        retention_derived_feature_days=1095,
    )
    register_mock = AsyncMock(return_value=True)
    monkeypatch.setattr("src.ingestion.raw_capture.get_settings", lambda: settings)
    monkeypatch.setattr("src.ingestion.retention.get_settings", lambda: settings)
    monkeypatch.setattr("src.ingestion.raw_capture.register_evidence_artifact", register_mock)

    result = await persist_raw_observation_payload(
        organization_id="org_test",
        source_type="news_api",
        source_id="article_1",
        payload={"title": "Headline", "summary": "Summary"},
        artifact_id="obsraw-test-1",
    )

    assert result.artifact_id == "obsraw-test-1"
    assert result.sha256
    assert result.byte_size > 0

    stored = Path(result.storage_path)
    assert stored.exists()
    decoded = json.loads(stored.read_text(encoding="utf-8"))
    assert decoded["title"] == "Headline"

    assert register_mock.await_count == 1
    kwargs = register_mock.await_args.kwargs
    assert kwargs["organization_id"] == "org_test"
    assert kwargs["artifact_id"] == "obsraw-test-1"
    assert kwargs["source_type"] == "news_api"
