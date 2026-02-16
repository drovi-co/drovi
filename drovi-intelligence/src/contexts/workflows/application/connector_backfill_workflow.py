from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from temporalio import workflow

from src.contexts.workflows.application._job_wait import wait_for_background_job


def _parse_utc_datetime(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        # Workflow inputs should be explicit, but we treat naive as UTC to avoid surprising failures.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class _BackfillWindow:
    start: datetime
    end: datetime


def _next_window(*, cursor: datetime, end: datetime, window_days: int) -> _BackfillWindow | None:
    if cursor >= end:
        return None
    safe_days = max(1, int(window_days))
    return _BackfillWindow(start=cursor, end=min(cursor + timedelta(days=safe_days), end))


@workflow.defn(name="connectors.backfill")
class ConnectorBackfillWorkflow:
    """
    Windowed connector backfill orchestrated by Temporal.

    This workflow is resumable and restart-safe because every window enqueue uses
    a deterministic idempotency key (connection + [start,end] + streams fingerprint).
    """

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "")
        connection_id = str(req.get("connection_id") or "")
        start_date_raw = req.get("start_date")
        if not organization_id or not connection_id or not start_date_raw:
            raise ValueError("ConnectorBackfillWorkflow requires organization_id, connection_id, start_date")

        streams = req.get("streams") or []
        if streams and not isinstance(streams, list):
            raise ValueError("streams must be a list")
        streams_list = [str(s) for s in streams] if isinstance(streams, list) else []
        streams_fingerprint = ",".join(streams_list) if streams_list else "*"

        start_date = _parse_utc_datetime(str(start_date_raw))
        end_date_raw = req.get("end_date")
        end_date = (
            _parse_utc_datetime(str(end_date_raw))
            if end_date_raw
            else workflow.now().astimezone(timezone.utc)
        )

        if end_date < start_date:
            raise ValueError("end_date must be >= start_date")

        window_days = int(req.get("window_days") or 7)
        throttle_seconds = float(req.get("throttle_seconds") or 0.0)
        throttle_seconds = max(0.0, throttle_seconds)

        # Support resumable execution via continue-as-new.
        cursor_raw = req.get("cursor")
        cursor = _parse_utc_datetime(str(cursor_raw)) if cursor_raw else start_date
        windows_completed = int(req.get("windows_completed") or 0)

        # Limit history size for large backfills.
        max_windows_per_run = int(req.get("max_windows_per_run") or 25)
        max_windows_per_run = max(1, min(max_windows_per_run, 200))

        while True:
            window = _next_window(cursor=cursor, end=end_date, window_days=window_days)
            if not window:
                break

            key_material = (
                f"backfill:{connection_id}:{window.start.isoformat()}:{window.end.isoformat()}:{streams_fingerprint}"
            )
            idempotency_key = hashlib.sha256(key_material.encode("utf-8")).hexdigest()

            job_id = await workflow.execute_activity(
                "jobs.enqueue",
                {
                    "organization_id": organization_id,
                    "job_type": "connector.sync",
                    "payload": {
                        "connection_id": connection_id,
                        "organization_id": organization_id,
                        "streams": streams_list or None,
                        "full_refresh": True,
                        "scheduled": False,
                        "sync_job_type": "backfill",
                        "backfill_start": window.start.isoformat(),
                        "backfill_end": window.end.isoformat(),
                        "sync_params": {
                            "backfill_start": window.start.isoformat(),
                            "backfill_end": window.end.isoformat(),
                        },
                    },
                    "priority": 1,
                    "max_attempts": 3,
                    "idempotency_key": idempotency_key,
                    "resource_key": f"connection:{connection_id}",
                },
                start_to_close_timeout=timedelta(seconds=15),
            )

            final = await wait_for_background_job(
                job_id=str(job_id),
                poll_every=timedelta(seconds=10),
                timeout=timedelta(hours=12),
            )
            if final.status != "succeeded":
                raise RuntimeError(
                    f"backfill window failed (job_id={final.job_id}, status={final.status})"
                )

            windows_completed += 1
            cursor = window.end

            if throttle_seconds > 0:
                await workflow.sleep(timedelta(seconds=throttle_seconds))

            if windows_completed % max_windows_per_run == 0 and cursor < end_date:
                # Keep history bounded for very large backfills.
                return await workflow.continue_as_new(
                    {
                        **req,
                        "cursor": cursor.isoformat(),
                        "windows_completed": windows_completed,
                    }
                )

        return {
            "connection_id": connection_id,
            "organization_id": organization_id,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "window_days": window_days,
            "throttle_seconds": throttle_seconds,
            "windows_completed": windows_completed,
        }

