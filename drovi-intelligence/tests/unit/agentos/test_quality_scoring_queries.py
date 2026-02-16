from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agentos.quality.scoring import RunQualityScoringService


class _FakeSessionContext:
    def __init__(self, session: AsyncMock):
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


def _row(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(_mapping=payload)


@pytest.mark.asyncio
async def test_list_scores_omits_null_filter_predicates() -> None:
    service = RunQualityScoringService()
    session = AsyncMock()
    result = MagicMock()
    result.fetchall.return_value = []
    session.execute = AsyncMock(return_value=result)

    with patch(
        "src.agentos.quality.scoring.get_db_session",
        lambda: _FakeSessionContext(session),
    ):
        rows = await service.list_scores(
            organization_id="org_test",
            run_id=None,
            role_id=None,
            deployment_id=None,
        )

    assert rows == []
    stmt = str(session.execute.call_args.args[0])
    params = session.execute.call_args.args[1]
    assert "IS NULL OR" not in stmt
    assert "run_id" not in params
    assert "role_id" not in params
    assert "deployment_id" not in params


@pytest.mark.asyncio
async def test_list_trends_omits_null_filter_predicates() -> None:
    service = RunQualityScoringService()
    session = AsyncMock()

    score_result = MagicMock()
    score_result.fetchall.return_value = [
        _row(
            {
                "bucket_start": datetime.now(timezone.utc),
                "run_count": 1,
                "avg_quality_score": 0.9,
                "avg_confidence_score": 0.8,
                "avg_outcome_score": 0.7,
            }
        )
    ]

    eval_result = MagicMock()
    eval_result.fetchall.return_value = [
        _row(
            {
                "bucket_start": datetime.now(timezone.utc),
                "total_count": 2,
                "passed_count": 1,
            }
        )
    ]
    session.execute = AsyncMock(side_effect=[score_result, eval_result])

    with patch(
        "src.agentos.quality.scoring.get_db_session",
        lambda: _FakeSessionContext(session),
    ):
        trends = await service.list_trends(
            organization_id="org_test",
            role_id=None,
            deployment_id=None,
            lookback_days=14,
        )

    assert trends.summary["run_count"] == 1
    first_stmt = str(session.execute.call_args_list[0].args[0])
    first_params = session.execute.call_args_list[0].args[1]
    second_stmt = str(session.execute.call_args_list[1].args[0])
    second_params = session.execute.call_args_list[1].args[1]

    assert "IS NULL OR" not in first_stmt
    assert "IS NULL OR" not in second_stmt
    assert "role_id" not in first_params
    assert "deployment_id" not in first_params
    assert "deployment_id" not in second_params
    assert "start_time" in first_params
    assert first_params["start_time"] <= datetime.now(timezone.utc) + timedelta(seconds=1)
