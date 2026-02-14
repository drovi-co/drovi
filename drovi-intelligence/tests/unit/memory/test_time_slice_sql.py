from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from src.memory.service import MemoryService


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_time_slice_truth_mode_uses_valid_range_containment() -> None:
    service = MemoryService("org_test", backend=MagicMock())
    captured: dict[str, object] = {}

    async def _fake_query_uios(*, where_clause: str, params: dict, limit: int):
        captured["where_clause"] = where_clause
        captured["params"] = params
        captured["limit"] = limit
        return []

    service._query_uios = _fake_query_uios  # type: ignore[method-assign]
    await service.time_slice_uios(
        as_of=datetime(2026, 2, 9, tzinfo=timezone.utc),
        mode="truth",
        limit=25,
    )

    where_clause = str(captured.get("where_clause") or "")
    assert "valid_range @> :as_of" in where_clause


@pytest.mark.asyncio
async def test_time_slice_knowledge_mode_uses_system_range_containment() -> None:
    service = MemoryService("org_test", backend=MagicMock())
    captured: dict[str, object] = {}

    async def _fake_query_uios(*, where_clause: str, params: dict, limit: int):
        captured["where_clause"] = where_clause
        return []

    service._query_uios = _fake_query_uios  # type: ignore[method-assign]
    await service.time_slice_uios(
        as_of=datetime(2026, 2, 9, tzinfo=timezone.utc),
        mode="knowledge",
        limit=25,
    )

    where_clause = str(captured.get("where_clause") or "")
    assert "tstzrange(system_from, COALESCE(system_to, 'infinity'::timestamptz), '[)') @> :as_of" in where_clause
