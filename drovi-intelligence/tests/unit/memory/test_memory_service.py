"""
Unit tests for the canonical MemoryService.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from src.memory.service import MemoryService, FalkorMemoryBackend


pytestmark = pytest.mark.unit


class TestMemoryServiceTimeSlice:
    @pytest.mark.asyncio
    async def test_time_slice_truth_filters_validity(self):
        memory = MemoryService("org_1", FalkorMemoryBackend("org_1"))
        memory._query_uios = AsyncMock(return_value=[])

        as_of = datetime(2024, 1, 10)
        await memory.time_slice_uios(
            as_of=as_of,
            mode="truth",
            uio_types=["commitment"],
            status="active",
            limit=5,
        )

        assert memory._query_uios.called
        where_clause = memory._query_uios.call_args.kwargs["where_clause"]
        assert "valid_from" in where_clause
        assert "valid_to" in where_clause
        assert "system_from" not in where_clause

    @pytest.mark.asyncio
    async def test_time_slice_knowledge_filters_system(self):
        memory = MemoryService("org_1", FalkorMemoryBackend("org_1"))
        memory._query_uios = AsyncMock(return_value=[])

        as_of = datetime(2024, 1, 10)
        await memory.time_slice_uios(
            as_of=as_of,
            mode="knowledge",
            limit=10,
        )

        where_clause = memory._query_uios.call_args.kwargs["where_clause"]
        assert "system_from" in where_clause
        assert "system_to" in where_clause
        assert "valid_from" not in where_clause


class TestMemoryServiceDecay:
    def test_apply_temporal_decay_prefers_recent(self):
        now = datetime(2024, 1, 10, 12, 0, 0)
        results = [
            {"id": "old", "created_at": "2023-12-01T00:00:00"},
            {"id": "new", "created_at": "2024-01-09T00:00:00"},
        ]

        ordered = MemoryService.apply_temporal_decay(results, half_life_days=30, now=now)

        assert ordered[0]["id"] == "new"
        assert ordered[0]["decay_score"] >= ordered[1]["decay_score"]


class TestMemoryServiceEvidence:
    @pytest.mark.asyncio
    async def test_get_uio_evidence_groups_by_uio(self):
        session = AsyncMock()
        rows = MagicMock()
        rows.fetchall.return_value = [
            SimpleNamespace(
                evidence_id="e1",
                uio_id="u1",
                source_type="email",
                source_account_id=None,
                conversation_id="c1",
                message_id="m1",
                quoted_text="quote",
                source_timestamp=datetime(2024, 1, 1),
            ),
            SimpleNamespace(
                evidence_id="e2",
                uio_id="u1",
                source_type="slack",
                source_account_id=None,
                conversation_id="c1",
                message_id="m2",
                quoted_text="quote 2",
                source_timestamp=datetime(2024, 1, 2),
            ),
            SimpleNamespace(
                evidence_id="e3",
                uio_id="u2",
                source_type="email",
                source_account_id=None,
                conversation_id="c2",
                message_id="m3",
                quoted_text="quote 3",
                source_timestamp=datetime(2024, 1, 3),
            ),
        ]
        session.execute.return_value = rows

        @asynccontextmanager
        async def fake_session():
            yield session

        memory = MemoryService("org_1", FalkorMemoryBackend("org_1"))
        with patch("src.memory.service.get_db_session", fake_session):
            evidence = await memory.get_uio_evidence(["u1", "u2"], limit_per_uio=2)

        assert "u1" in evidence
        assert "u2" in evidence
        assert len(evidence["u1"]) == 2
        assert evidence["u1"][0]["evidence_id"] == "e1"
        assert evidence["u2"][0]["evidence_id"] == "e3"

    @pytest.mark.asyncio
    async def test_get_uio_evidence_includes_transcript_metadata(self):
        session = AsyncMock()
        rows = MagicMock()
        rows.fetchall.return_value = [
            SimpleNamespace(
                evidence_id="e1",
                uio_id="u1",
                source_type="transcript",
                source_account_id=None,
                conversation_id="session_1",
                message_id="segment_1",
                quoted_text="Transcript snippet",
                source_timestamp=datetime(2024, 1, 1, 12, 0, 0),
                start_ms=1500,
                end_ms=4200,
                speaker_label="Speaker 1",
                speaker_contact_id="contact_1",
                evidence_timestamp=datetime(2024, 1, 1, 12, 0, 1),
            )
        ]
        session.execute.return_value = rows

        @asynccontextmanager
        async def fake_session():
            yield session

        memory = MemoryService("org_1", FalkorMemoryBackend("org_1"))
        with patch("src.memory.service.get_db_session", fake_session):
            evidence = await memory.get_uio_evidence(["u1"], limit_per_uio=2)

        assert evidence["u1"][0]["start_ms"] == 1500
        assert evidence["u1"][0]["end_ms"] == 4200
        assert evidence["u1"][0]["speaker_label"] == "Speaker 1"
        assert evidence["u1"][0]["speaker_contact_id"] == "contact_1"
