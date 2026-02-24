"""High-level frontier service for seed + dispatch operations."""

from __future__ import annotations

from typing import Any

from src.crawlers.pipeline import create_frontier_seed, run_crawl_frontier_tick


async def seed_frontier_url(
    *,
    organization_id: str,
    source_key: str,
    url: str,
    seed_type: str = "manual",
    priority: int = 0,
    freshness_policy_minutes: int = 60,
    metadata: dict[str, Any] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    return await create_frontier_seed(
        organization_id=organization_id,
        source_key=source_key,
        url=url,
        seed_type=seed_type,
        priority=priority,
        freshness_policy_minutes=freshness_policy_minutes,
        metadata=metadata,
        actor=actor,
    )


async def dispatch_frontier_tick(*, sync_params: dict[str, Any] | None = None) -> dict[str, Any]:
    return await run_crawl_frontier_tick(sync_params=sync_params)
