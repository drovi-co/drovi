"""
Unit tests for the canonical MemoryService.
"""

from datetime import datetime
from unittest.mock import AsyncMock

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
