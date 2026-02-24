from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from src.crawlers.frontier.scheduler import (
    CrawlDispatch,
    CrawlFrontierScheduler,
    build_frontier_fetch_idempotency_key,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_frontier_fetch_idempotency_key_is_bucketed() -> None:
    now = datetime(2026, 2, 23, 12, 0, 10, tzinfo=timezone.utc)
    key_a = build_frontier_fetch_idempotency_key(
        frontier_entry_id="frontier_1",
        bucket_seconds=120,
        now=now,
    )
    key_b = build_frontier_fetch_idempotency_key(
        frontier_entry_id="frontier_1",
        bucket_seconds=120,
        now=now + timedelta(seconds=100),
    )
    key_c = build_frontier_fetch_idempotency_key(
        frontier_entry_id="frontier_1",
        bucket_seconds=120,
        now=now + timedelta(seconds=121),
    )

    assert key_a == key_b
    assert key_a != key_c


async def test_frontier_scheduler_claim_dispatches_maps_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    scheduler = CrawlFrontierScheduler(dispatch_limit=10, per_domain_limit=2)
    monkeypatch.setattr(
        "src.crawlers.frontier.scheduler.claim_due_frontier_entries",
        AsyncMock(
            return_value=[
                {
                    "id": "f1",
                    "organization_id": "org_test",
                    "url": "https://example.com/a",
                    "domain": "example.com",
                    "source_key": "rss_osint",
                    "priority": 2,
                }
            ]
        ),
    )

    dispatches = await scheduler.claim_dispatches()

    assert dispatches == [
        CrawlDispatch(
            frontier_entry_id="f1",
            organization_id="org_test",
            url="https://example.com/a",
            domain="example.com",
            source_key="rss_osint",
            priority=2,
        )
    ]


async def test_frontier_scheduler_enqueues_fetch_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    scheduler = CrawlFrontierScheduler(dispatch_limit=10, per_domain_limit=2)
    enqueue_job = AsyncMock(side_effect=["job_1", "job_2"])
    write_audit = AsyncMock(return_value="audit_1")
    monkeypatch.setattr("src.crawlers.frontier.scheduler.enqueue_job", enqueue_job)
    monkeypatch.setattr("src.crawlers.frontier.scheduler.write_audit_log", write_audit)

    dispatches = [
        CrawlDispatch(
            frontier_entry_id="f1",
            organization_id="org_test",
            url="https://example.com/a",
            domain="example.com",
            source_key="rss_osint",
            priority=2,
        ),
        CrawlDispatch(
            frontier_entry_id="f2",
            organization_id="org_test",
            url="https://example.com/b",
            domain="example.com",
            source_key="rss_osint",
            priority=1,
        ),
    ]

    job_ids = await scheduler.enqueue_fetch_jobs(dispatches)

    assert job_ids == ["job_1", "job_2"]
    assert enqueue_job.await_count == 2
    assert write_audit.await_count == 2
