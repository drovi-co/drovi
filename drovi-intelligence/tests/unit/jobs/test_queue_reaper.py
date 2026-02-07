from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_requeue_expired_running_jobs_returns_count(mock_db_pool):
    conn = mock_db_pool.acquire.return_value.__aenter__.return_value
    conn.fetch.return_value = [{"id": "job_1"}, {"id": "job_2"}]

    from src.jobs.queue import requeue_expired_running_jobs

    count = await requeue_expired_running_jobs(limit=123)

    assert count == 2
    assert conn.fetch.called
