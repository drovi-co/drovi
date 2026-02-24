#!/usr/bin/env python3
"""Enqueue world-brain recurring maintenance jobs with idempotent buckets."""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime
import json
from typing import Any

from src.jobs.queue import EnqueueJobRequest, enqueue_job


def _parse_org_ids(raw: str | None) -> list[str]:
    if not raw:
        return ["internal"]
    text = raw.strip()
    if not text:
        return ["internal"]
    if text.startswith("["):
        try:
            values = json.loads(text)
        except Exception:
            values = []
        items = [str(item).strip() for item in values if str(item).strip()]
        return items or ["internal"]
    items = [item.strip() for item in text.split(",") if item.strip()]
    return items or ["internal"]


def _bucket(interval_seconds: int) -> int:
    return int(datetime.now(UTC).timestamp()) // max(1, int(interval_seconds))


async def _enqueue(profile: str, organization_ids: list[str]) -> dict[str, Any]:
    profile_name = profile.strip().lower()
    if profile_name not in {"fast", "hourly"}:
        raise ValueError("profile must be one of: fast, hourly")

    queued: list[dict[str, Any]] = []

    # Always keep connector health monitor active as failover safety.
    health_bucket = _bucket(300)
    health_job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id="internal",
            job_type="connectors.health_monitor",
            payload={"organization_id": "internal", "initiator": "cron_failover"},
            priority=1,
            max_attempts=2,
            idempotency_key=f"world_maintenance:connectors_health_monitor:{health_bucket}",
            resource_key="world:maintenance:connectors_health_monitor",
        )
    )
    queued.append({"job_type": "connectors.health_monitor", "job_id": health_job_id, "organization_id": "internal"})

    for organization_id in organization_ids:
        if profile_name == "fast":
            bucket_15m = _bucket(900)
            job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=organization_id,
                    job_type="world_twin.prematerialize",
                    payload={"organization_id": organization_id},
                    priority=2,
                    max_attempts=2,
                    idempotency_key=f"world_maintenance:prematerialize:{organization_id}:{bucket_15m}",
                    resource_key=f"world:maintenance:prematerialize:{organization_id}",
                )
            )
            queued.append(
                {"job_type": "world_twin.prematerialize", "job_id": job_id, "organization_id": organization_id}
            )
            continue

        # Hourly profile.
        bucket_hour = _bucket(3600)
        lifecycle_job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=organization_id,
                job_type="lakehouse.lifecycle",
                payload={"organization_id": organization_id, "limit": 10000},
                priority=1,
                max_attempts=2,
                idempotency_key=f"world_maintenance:lakehouse_lifecycle:{organization_id}:{bucket_hour}",
                resource_key=f"world:maintenance:lakehouse_lifecycle:{organization_id}",
            )
        )
        queued.append({"job_type": "lakehouse.lifecycle", "job_id": lifecycle_job_id, "organization_id": organization_id})

        reliability_job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=organization_id,
                job_type="source.reliability.calibrate",
                payload={"organization_id": organization_id, "lookback_days": 30},
                priority=1,
                max_attempts=2,
                idempotency_key=f"world_maintenance:source_reliability:{organization_id}:{bucket_hour}",
                resource_key=f"world:maintenance:source_reliability:{organization_id}",
            )
        )
        queued.append(
            {
                "job_type": "source.reliability.calibrate",
                "job_id": reliability_job_id,
                "organization_id": organization_id,
            }
        )

    return {
        "profile": profile_name,
        "organization_count": len(organization_ids),
        "queued_count": len(queued),
        "queued": queued,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Enqueue world-brain maintenance jobs.")
    parser.add_argument("--profile", choices=["fast", "hourly"], default="fast")
    parser.add_argument(
        "--organization-ids",
        default=None,
        help="Comma-separated org ids or JSON list. Defaults to WORLD_BRAIN_MAINTENANCE_ORG_IDS env or ['internal'].",
    )
    args = parser.parse_args()

    import os

    organization_ids = _parse_org_ids(args.organization_ids or os.getenv("WORLD_BRAIN_MAINTENANCE_ORG_IDS"))
    result = asyncio.run(_enqueue(args.profile, organization_ids))
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()

