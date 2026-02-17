from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_worker_runs_weekly_operations_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_weekly_ops_1",
        organization_id="internal",
        job_type="reports.weekly_operations",
        status="running",
        priority=0,
        run_at=datetime.now(timezone.utc),
        resource_key="system:operations_weekly_brief",
        attempts=1,
        max_attempts=1,
        payload={"pilot_only": True, "brief_days": 7, "blindspot_days": 30},
    )

    mock_run = AsyncMock(
        return_value={"organizations": 2, "executive_briefs": 2, "blindspot_reports": 2}
    )
    monkeypatch.setattr(
        "src.jobs.operational_reports.run_weekly_operations_briefs",
        mock_run,
    )

    result = await worker._run_reports_weekly_operations(job)
    assert result["organizations"] == 2
    assert result["brief_days"] == 7
    mock_run.assert_awaited_once_with(pilot_only=True, brief_days=7, blindspot_days=30)


async def test_worker_runs_monthly_integrity_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_integrity_1",
        organization_id="internal",
        job_type="trust.integrity_monthly",
        status="running",
        priority=0,
        run_at=datetime.now(timezone.utc),
        resource_key="system:integrity_monthly_report",
        attempts=1,
        max_attempts=1,
        payload={"pilot_only": True, "month": "2026-02"},
    )

    mock_run = AsyncMock(return_value={"organizations": 3, "reports_generated": 3})
    monkeypatch.setattr(
        "src.jobs.operational_reports.run_monthly_integrity_reports",
        mock_run,
    )

    result = await worker._run_monthly_integrity_reports(job)
    assert result["organizations"] == 3
    assert result["month"] == "2026-02"
    mock_run.assert_awaited_once_with(pilot_only=True, month="2026-02")
