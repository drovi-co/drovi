"""Console pre-aggregate materialization and reads.

These aggregates are maintained asynchronously from outbox events so hot
dashboards can avoid repeated heavyweight COUNT/GROUP scans.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

from src.db.client import get_db_pool
from src.db.rls import rls_context

logger = structlog.get_logger()


async def refresh_console_preaggregates(
    *,
    organization_id: str,
    lookback_days: int = 90,
) -> dict[str, Any]:
    """
    Rebuild per-org console pre-aggregates.

    This runs in an async worker path (outbox drain), not in request handlers.
    """
    if not organization_id:
        raise ValueError("organization_id is required")

    lookback_days = max(1, min(int(lookback_days), 365))
    lookback_cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            metrics_row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*)::int AS total_count,
                    COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
                    COUNT(*) FILTER (
                        WHERE due_date IS NOT NULL
                          AND due_date > NOW()
                          AND due_date <= NOW() + INTERVAL '3 days'
                          AND status NOT IN ('completed', 'cancelled', 'archived')
                    )::int AS at_risk_count,
                    COUNT(*) FILTER (
                        WHERE due_date IS NOT NULL
                          AND due_date < NOW()
                          AND status NOT IN ('completed', 'cancelled', 'archived')
                    )::int AS overdue_count,
                    AVG(overall_confidence)::float AS avg_confidence
                FROM unified_intelligence_object
                WHERE organization_id = $1
                """,
                organization_id,
            )

            await conn.execute(
                """
                INSERT INTO console_org_metrics (
                    organization_id,
                    total_count,
                    active_count,
                    at_risk_count,
                    overdue_count,
                    avg_confidence,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (organization_id)
                DO UPDATE SET
                    total_count = EXCLUDED.total_count,
                    active_count = EXCLUDED.active_count,
                    at_risk_count = EXCLUDED.at_risk_count,
                    overdue_count = EXCLUDED.overdue_count,
                    avg_confidence = EXCLUDED.avg_confidence,
                    updated_at = NOW()
                """,
                organization_id,
                int((metrics_row or {}).get("total_count") or 0),
                int((metrics_row or {}).get("active_count") or 0),
                int((metrics_row or {}).get("at_risk_count") or 0),
                int((metrics_row or {}).get("overdue_count") or 0),
                float(metrics_row["avg_confidence"]) if metrics_row and metrics_row["avg_confidence"] is not None else None,
            )

            bucket_rows = await conn.fetch(
                """
                SELECT
                    date_trunc('hour', created_at) AS bucket,
                    COUNT(*)::int AS count
                FROM unified_intelligence_object
                WHERE organization_id = $1
                  AND created_at >= $2
                GROUP BY 1
                ORDER BY 1 ASC
                """,
                organization_id,
                lookback_cutoff,
            )

            await conn.execute(
                """
                DELETE FROM console_org_histogram_hour
                WHERE organization_id = $1
                """,
                organization_id,
            )
            if bucket_rows:
                await conn.executemany(
                    """
                    INSERT INTO console_org_histogram_hour (
                        organization_id,
                        bucket,
                        count,
                        updated_at
                    )
                    VALUES ($1, $2, $3, NOW())
                    """,
                    [
                        (
                            organization_id,
                            row["bucket"],
                            int(row["count"] or 0),
                        )
                        for row in bucket_rows
                    ],
                )

    return {
        "organization_id": organization_id,
        "lookback_days": lookback_days,
        "bucket_count": len(bucket_rows or []),
        "total_count": int((metrics_row or {}).get("total_count") or 0),
    }


async def fetch_console_metrics_preaggregate(
    *,
    organization_id: str,
    max_age_seconds: int = 120,
) -> dict[str, Any] | None:
    if not organization_id:
        return None

    max_age_seconds = max(1, int(max_age_seconds))
    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    total_count,
                    active_count,
                    at_risk_count,
                    overdue_count,
                    avg_confidence,
                    updated_at
                FROM console_org_metrics
                WHERE organization_id = $1
                  AND updated_at >= NOW() - ($2::int * INTERVAL '1 second')
                """,
                organization_id,
                max_age_seconds,
            )
    if not row:
        return None

    return {
        "total_count": int(row["total_count"] or 0),
        "active_count": int(row["active_count"] or 0),
        "at_risk_count": int(row["at_risk_count"] or 0),
        "overdue_count": int(row["overdue_count"] or 0),
        "avg_confidence": float(row["avg_confidence"]) if row["avg_confidence"] is not None else None,
        "updated_at": row["updated_at"],
    }


async def fetch_console_timeseries_preaggregate(
    *,
    organization_id: str,
    start_time: datetime,
    end_time: datetime,
    max_points: int = 100,
    max_age_seconds: int = 120,
) -> list[dict[str, Any]] | None:
    if not organization_id:
        return None
    if end_time <= start_time:
        return []

    max_points = max(1, min(int(max_points), 1000))
    max_age_seconds = max(1, int(max_age_seconds))

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT bucket, count
                FROM console_org_histogram_hour
                WHERE organization_id = $1
                  AND bucket >= $2
                  AND bucket <= $3
                  AND updated_at >= NOW() - ($4::int * INTERVAL '1 second')
                ORDER BY bucket ASC
                """,
                organization_id,
                start_time,
                end_time,
                max_age_seconds,
            )

    if rows is None:
        return None
    if not rows:
        return []

    points = [{"timestamp": row["bucket"], "count": int(row["count"] or 0)} for row in rows]
    if len(points) <= max_points:
        return points

    # Downsample by stride while preserving first/last ordering.
    stride = max(1, len(points) // max_points)
    reduced = points[::stride]
    if reduced[-1]["timestamp"] != points[-1]["timestamp"]:
        reduced.append(points[-1])
    return reduced[:max_points]
