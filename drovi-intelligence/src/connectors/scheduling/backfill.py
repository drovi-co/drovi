"""
Backfill orchestration helpers.

Splits historical ranges into windows and runs sync jobs sequentially.
"""

from __future__ import annotations

from dataclasses import dataclass
import asyncio
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.connectors.connection_service import get_connection_config
from src.connectors.scheduling.scheduler import ConnectorScheduler, SyncJob, SyncJobType

logger = structlog.get_logger()


@dataclass
class BackfillWindow:
    """Represents a backfill window."""

    start: datetime
    end: datetime


def generate_backfill_windows(
    start_date: datetime,
    end_date: datetime,
    window_days: int = 7,
) -> list[BackfillWindow]:
    """Generate contiguous backfill windows."""
    windows: list[BackfillWindow] = []
    cursor = start_date

    while cursor < end_date:
        window_end = min(cursor + timedelta(days=window_days), end_date)
        windows.append(BackfillWindow(start=cursor, end=window_end))
        cursor = window_end

    return windows


async def run_backfill_plan(
    scheduler: ConnectorScheduler,
    connection_id: str,
    organization_id: str,
    start_date: datetime,
    end_date: datetime | None = None,
    window_days: int = 7,
    streams: list[str] | None = None,
    throttle_seconds: float = 1.0,
) -> list[str]:
    """
    Run a backfill plan sequentially across time windows.
    """
    end_date = end_date or datetime.utcnow()
    windows = generate_backfill_windows(start_date, end_date, window_days=window_days)

    if not windows:
        return []

    config = await get_connection_config(connection_id, organization_id)
    if not config:
        raise ValueError(f"Connection not found: {connection_id}")

    job_ids: list[str] = []

    for idx, window in enumerate(windows, start=1):
        sync_params: dict[str, Any] = {
            "backfill_start": window.start.isoformat(),
            "backfill_end": window.end.isoformat(),
            "backfill_window_index": idx,
            "backfill_window_total": len(windows),
        }

        window_config = config.model_copy()
        window_config.backfill_start_date = window.start
        window_config.provider_config = {
            **window_config.provider_config,
            "sync_params": sync_params,
        }

        job = SyncJob(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=window_config.connector_type,
            job_type=SyncJobType.BACKFILL,
            streams=streams or [],
            full_refresh=True,
            backfill_start_date=window.start,
            backfill_end_date=window.end,
            sync_params=sync_params,
        )

        logger.info(
            "Running backfill window",
            connection_id=connection_id,
            connector_type=window_config.connector_type,
            window_start=window.start.isoformat(),
            window_end=window.end.isoformat(),
            window_index=idx,
            window_total=len(windows),
        )

        result = await scheduler._execute_sync(job, window_config)
        job_ids.append(job.job_id)

        if result.status.value != "completed":
            logger.error(
                "Backfill window failed",
                connection_id=connection_id,
                window_index=idx,
                error=result.error_message,
            )
            break

        if throttle_seconds > 0:
            await asyncio.sleep(throttle_seconds)

    return job_ids
