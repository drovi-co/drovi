#!/usr/bin/env python3
"""Generate World Brain SLA and error-budget reports from run ledgers."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
import os
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import asyncpg


def _normalize_database_url(raw: str) -> str:
    if "+asyncpg" not in raw:
        return raw
    parts = urlsplit(raw)
    scheme = parts.scheme.replace("+asyncpg", "")
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, parts.fragment))


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (max(0.0, min(float(percentile), 100.0)) / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return float(ordered[lower] + (ordered[upper] - ordered[lower]) * weight)


@dataclass(frozen=True, slots=True)
class ConnectorAggregate:
    connector_type: str
    runs_total: int
    runs_success: int
    runs_failed: int
    p95_freshness_lag_minutes: float
    p95_duration_seconds: float

    @property
    def success_rate(self) -> float:
        if self.runs_total <= 0:
            return 1.0
        return float(self.runs_success / self.runs_total)

    @property
    def error_budget_burn(self) -> float:
        if self.runs_total <= 0:
            return 0.0
        return float(self.runs_failed / self.runs_total)

    def as_dict(self) -> dict[str, Any]:
        return {
            "connector_type": self.connector_type,
            "runs_total": self.runs_total,
            "runs_success": self.runs_success,
            "runs_failed": self.runs_failed,
            "success_rate": round(self.success_rate, 6),
            "error_budget_burn": round(self.error_budget_burn, 6),
            "p95_freshness_lag_minutes": round(self.p95_freshness_lag_minutes, 3),
            "p95_duration_seconds": round(self.p95_duration_seconds, 3),
            "status": _status_from_burn(self.error_budget_burn),
        }


def _status_from_burn(burn: float) -> str:
    if burn >= 0.2:
        return "critical"
    if burn >= 0.1:
        return "elevated"
    if burn >= 0.05:
        return "warning"
    return "healthy"


def compute_sla_report(
    *,
    runs: list[dict[str, Any]],
    failed_jobs: list[dict[str, Any]],
    lookback_hours: int,
) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in runs:
        connector_type = str(row.get("connector_type") or "unknown")
        grouped.setdefault(connector_type, []).append(row)

    connector_reports: list[ConnectorAggregate] = []
    for connector_type, rows in sorted(grouped.items()):
        freshness_values = [
            float(row.get("freshness_lag_minutes") or 0.0)
            for row in rows
            if row.get("freshness_lag_minutes") is not None
        ]
        duration_values = [
            float(row.get("duration_seconds") or 0.0)
            for row in rows
            if row.get("duration_seconds") is not None
        ]
        success_count = sum(1 for row in rows if str(row.get("status") or "") == "succeeded")
        failed_count = sum(1 for row in rows if str(row.get("status") or "") == "failed")
        connector_reports.append(
            ConnectorAggregate(
                connector_type=connector_type,
                runs_total=len(rows),
                runs_success=success_count,
                runs_failed=failed_count,
                p95_freshness_lag_minutes=_percentile(freshness_values, 95.0),
                p95_duration_seconds=_percentile(duration_values, 95.0),
            )
        )

    total_runs = sum(report.runs_total for report in connector_reports)
    total_failures = sum(report.runs_failed for report in connector_reports)
    overall_burn = (float(total_failures) / float(total_runs)) if total_runs else 0.0
    failure_by_job_type: dict[str, int] = {}
    for row in failed_jobs:
        job_type = str(row.get("job_type") or "unknown")
        failure_by_job_type[job_type] = int(failure_by_job_type.get(job_type, 0)) + 1

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "lookback_hours": int(max(1, lookback_hours)),
        "overall": {
            "runs_total": total_runs,
            "runs_failed": total_failures,
            "error_budget_burn": round(overall_burn, 6),
            "status": _status_from_burn(overall_burn),
            "failed_background_jobs": int(len(failed_jobs)),
        },
        "connectors": [item.as_dict() for item in connector_reports],
        "failures_by_job_type": dict(sorted(failure_by_job_type.items())),
    }


async def _fetch_rows(*, database_url: str, lookback_hours: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cutoff = datetime.now(UTC) - timedelta(hours=max(1, int(lookback_hours)))
    connection = await asyncpg.connect(database_url)
    try:
        run_rows = await connection.fetch(
            """
            SELECT
                connector_type,
                status,
                freshness_lag_minutes,
                duration_seconds
            FROM source_sync_run
            WHERE started_at >= $1::timestamptz
            """,
            cutoff,
        )
        failed_job_rows = await connection.fetch(
            """
            SELECT job_type
            FROM background_job
            WHERE updated_at >= $1::timestamptz
              AND status = 'failed'
            """,
            cutoff,
        )
    finally:
        await connection.close()

    return ([dict(row) for row in run_rows], [dict(row) for row in failed_job_rows])


async def _run(*, lookback_hours: int, database_url: str) -> dict[str, Any]:
    runs, failed_jobs = await _fetch_rows(
        database_url=_normalize_database_url(database_url),
        lookback_hours=lookback_hours,
    )
    return compute_sla_report(
        runs=runs,
        failed_jobs=failed_jobs,
        lookback_hours=lookback_hours,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate world-brain SLA/error-budget report.")
    parser.add_argument("--lookback-hours", type=int, default=24, help="Lookback window for run/failure aggregation.")
    parser.add_argument(
        "--database-url",
        type=str,
        default=None,
        help="Override DATABASE_URL/DROVI_DATABASE_URL.",
    )
    args = parser.parse_args()

    database_url = args.database_url or os.getenv("DROVI_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("Missing database URL. Set --database-url or DROVI_DATABASE_URL/DATABASE_URL.")

    report = asyncio.run(_run(lookback_hours=args.lookback_hours, database_url=database_url))
    print(json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
