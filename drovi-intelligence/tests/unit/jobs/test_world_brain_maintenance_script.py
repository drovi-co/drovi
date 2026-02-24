from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from scripts.enqueue_world_brain_maintenance import _enqueue, _parse_org_ids

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def test_parse_org_ids_supports_json_and_csv() -> None:
    assert _parse_org_ids('["org_a","org_b"]') == ["org_a", "org_b"]
    assert _parse_org_ids("org_a, org_b") == ["org_a", "org_b"]
    assert _parse_org_ids("") == ["internal"]


async def test_enqueue_fast_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue_mock = AsyncMock(side_effect=["job_1", "job_2"])
    monkeypatch.setattr("scripts.enqueue_world_brain_maintenance.enqueue_job", enqueue_mock)

    result = await _enqueue("fast", ["org_1"])

    assert result["profile"] == "fast"
    assert result["queued_count"] == 2
    assert enqueue_mock.await_count == 2


async def test_enqueue_hourly_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    enqueue_mock = AsyncMock(side_effect=["job_h1", "job_h2", "job_h3"])
    monkeypatch.setattr("scripts.enqueue_world_brain_maintenance.enqueue_job", enqueue_mock)

    result = await _enqueue("hourly", ["org_1"])

    assert result["profile"] == "hourly"
    assert result["queued_count"] == 3
    assert enqueue_mock.await_count == 3
