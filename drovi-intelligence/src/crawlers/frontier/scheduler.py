"""Domain-aware crawl frontier scheduler."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from typing import Any

from src.crawlers.repository import claim_due_frontier_entries, write_audit_log
from src.jobs.queue import EnqueueJobRequest, enqueue_job


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_frontier_fetch_idempotency_key(
    *,
    frontier_entry_id: str,
    bucket_seconds: int,
    now: datetime | None = None,
) -> str:
    now = now or _utc_now()
    bucket = int(now.timestamp()) // max(1, int(bucket_seconds))
    return f"crawl_fetch:{frontier_entry_id}:{bucket}"


def _domain_slot(domain: str, frontier_entry_id: str, per_domain_limit: int) -> int:
    material = f"{domain}:{frontier_entry_id}".encode("utf-8")
    value = int(hashlib.sha256(material).hexdigest(), 16)
    return value % max(1, int(per_domain_limit))


@dataclass(frozen=True)
class CrawlDispatch:
    frontier_entry_id: str
    organization_id: str
    url: str
    domain: str
    source_key: str
    priority: int


class CrawlFrontierScheduler:
    def __init__(
        self,
        *,
        dispatch_limit: int,
        per_domain_limit: int,
        idempotency_bucket_seconds: int = 120,
    ) -> None:
        self.dispatch_limit = max(1, int(dispatch_limit))
        self.per_domain_limit = max(1, int(per_domain_limit))
        self.idempotency_bucket_seconds = max(30, int(idempotency_bucket_seconds))

    async def claim_dispatches(self) -> list[CrawlDispatch]:
        rows = await claim_due_frontier_entries(
            limit=self.dispatch_limit,
            per_domain_limit=self.per_domain_limit,
        )
        dispatches: list[CrawlDispatch] = []
        for row in rows:
            dispatches.append(
                CrawlDispatch(
                    frontier_entry_id=str(row["id"]),
                    organization_id=str(row["organization_id"]),
                    url=str(row["url"]),
                    domain=str(row["domain"]),
                    source_key=str(row.get("source_key") or "crawler"),
                    priority=int(row.get("priority") or 0),
                )
            )
        return dispatches

    async def enqueue_fetch_jobs(
        self,
        dispatches: list[CrawlDispatch],
        *,
        sync_params: dict[str, Any] | None = None,
    ) -> list[str]:
        job_ids: list[str] = []
        now = _utc_now()
        for dispatch in dispatches:
            slot = _domain_slot(dispatch.domain, dispatch.frontier_entry_id, self.per_domain_limit)
            idempotency_key = build_frontier_fetch_idempotency_key(
                frontier_entry_id=dispatch.frontier_entry_id,
                bucket_seconds=self.idempotency_bucket_seconds,
                now=now,
            )
            job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=dispatch.organization_id,
                    job_type="crawl.fetch",
                    payload={
                        "frontier_entry_id": dispatch.frontier_entry_id,
                        "organization_id": dispatch.organization_id,
                        "url": dispatch.url,
                        "domain": dispatch.domain,
                        "source_key": dispatch.source_key,
                        "sync_params": sync_params or {},
                    },
                    priority=max(0, min(9, dispatch.priority)),
                    max_attempts=4,
                    idempotency_key=idempotency_key,
                    resource_key=f"crawl-domain:{dispatch.domain}:{slot}",
                )
            )
            job_ids.append(job_id)
            await write_audit_log(
                organization_id=dispatch.organization_id,
                event_type="crawl.frontier.dispatched",
                frontier_entry_id=dispatch.frontier_entry_id,
                decision="queued_for_fetch",
                metadata={
                    "job_id": job_id,
                    "domain": dispatch.domain,
                    "resource_slot": slot,
                },
            )
        return job_ids
