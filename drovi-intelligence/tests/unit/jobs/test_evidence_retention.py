from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.jobs.evidence_retention import EvidenceRetentionJob


@pytest.mark.asyncio
async def test_evidence_retention_deletes_expired():
    session = AsyncMock()
    rows = MagicMock()
    rows.fetchall.return_value = [
        SimpleNamespace(
            id="artifact_1",
            organization_id="org_1",
            storage_path="/tmp/artifact_1.wav",
            storage_backend="local",
            retention_until="2024-01-01",
            immutable=False,
            legal_hold=False,
        )
    ]
    session.execute.side_effect = [rows, AsyncMock()]

    @asynccontextmanager
    async def fake_session():
        yield session

    storage = AsyncMock()
    storage.delete.return_value = True

    with patch("src.jobs.evidence_retention.get_db_session", fake_session), patch(
        "src.jobs.evidence_retention.get_evidence_storage",
        return_value=storage,
    ), patch(
        "src.jobs.evidence_retention.record_evidence_audit",
        AsyncMock(),
    ):
        job = EvidenceRetentionJob()
        stats = await job.run()

    assert stats["deleted"] == 1
    storage.delete.assert_called_with("/tmp/artifact_1.wav")


@pytest.mark.asyncio
async def test_evidence_retention_skips_legal_hold():
    session = AsyncMock()
    rows = MagicMock()
    rows.fetchall.return_value = [
        SimpleNamespace(
            id="artifact_2",
            organization_id="org_1",
            storage_path="/tmp/artifact_2.wav",
            storage_backend="local",
            retention_until="2024-01-01",
            immutable=False,
            legal_hold=True,
        )
    ]
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    storage = AsyncMock()

    with patch("src.jobs.evidence_retention.get_db_session", fake_session), patch(
        "src.jobs.evidence_retention.get_evidence_storage",
        return_value=storage,
    ), patch(
        "src.jobs.evidence_retention.record_evidence_audit",
        AsyncMock(),
    ):
        job = EvidenceRetentionJob()
        stats = await job.run()

    assert stats["skipped_legal_hold"] == 1
    storage.delete.assert_not_called()
