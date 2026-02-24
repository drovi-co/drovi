from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.jobs.custody_integrity import (
    COGNITIVE_HASH_SPECS,
    CustodyIntegrityJob,
    _load_daily_hashes,
)


@pytest.mark.asyncio
async def test_load_daily_hashes_includes_cognitive_object_hashes() -> None:
    session = AsyncMock()

    artifact_rows = MagicMock()
    artifact_rows.fetchall.return_value = [SimpleNamespace(sha256="a1"), SimpleNamespace(sha256="a2")]
    event_rows = MagicMock()
    event_rows.fetchall.return_value = [SimpleNamespace(content_hash="e1")]

    expected_family_counts: dict[str, int] = {}
    cognitive_results: list[MagicMock] = []
    for index, (table_name, _, _) in enumerate(COGNITIVE_HASH_SPECS):
        row_count = 1 if index % 2 == 0 else 2
        expected_family_counts[table_name] = row_count
        rows = MagicMock()
        rows.fetchall.return_value = [
            SimpleNamespace(hash_value=f"{table_name}-hash-{item_index}")
            for item_index in range(row_count)
        ]
        cognitive_results.append(rows)

    session.execute.side_effect = [artifact_rows, event_rows, *cognitive_results]

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.jobs.custody_integrity.get_db_session", fake_session):
        leaves, artifact_count, event_count, cognitive_count, family_counts = await _load_daily_hashes(
            organization_id="org-1",
            root_date=date(2026, 2, 21),
        )

    assert artifact_count == 2
    assert event_count == 1
    assert cognitive_count == sum(expected_family_counts.values())
    assert family_counts == expected_family_counts
    assert "artifact:a1" in leaves
    assert "event:e1" in leaves
    assert any(leaf.startswith("cognitive:belief:") for leaf in leaves)


@pytest.mark.asyncio
async def test_custody_integrity_job_persists_cognitive_counts_in_metadata() -> None:
    session = AsyncMock()
    session.execute.return_value = MagicMock()

    @asynccontextmanager
    async def fake_session():
        yield session

    with (
        patch("src.jobs.custody_integrity.get_db_session", fake_session),
        patch("src.jobs.custody_integrity._resolve_signing_secret", return_value=("secret", "key-1")),
        patch(
            "src.jobs.custody_integrity._load_daily_hashes",
            AsyncMock(
                return_value=(
                    ["artifact:a1", "cognitive:belief:b1"],
                    1,
                    0,
                    1,
                    {"belief": 1},
                )
            ),
        ),
        patch("src.jobs.custody_integrity.utc_now", return_value=datetime(2026, 2, 22, 12, 0, 0, tzinfo=timezone.utc)),
    ):
        job = CustodyIntegrityJob()
        result = await job.run(organization_id="org-1", root_date=date(2026, 2, 21))

    _, params = session.execute.call_args.args
    metadata = json.loads(params["metadata"])

    assert result["cognitive_count"] == 1
    assert metadata["cognitive_count"] == 1
    assert metadata["cognitive_family_counts"] == {"belief": 1}
    assert "belief.belief_hash" in metadata["sources"]
