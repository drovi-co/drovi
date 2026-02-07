"""
Durable Jobs Worker

Executes jobs from the Postgres-backed `background_job` queue.
This is the command plane (sync/backfill/reports/maintenance).
"""

from __future__ import annotations

import asyncio
import hashlib
import signal
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import structlog

from src.config import get_settings
from src.db.client import close_db, close_db_pool, init_db
from src.jobs.queue import (
    ClaimedJob,
    claim_next_job,
    compute_backoff_seconds,
    extend_lease,
    mark_job_failed,
    mark_job_succeeded,
    requeue_expired_running_jobs,
)

logger = structlog.get_logger()

def _parse_iso_datetime(value: str) -> datetime:
    """
    Parse an ISO 8601 timestamp coming from JSON payloads.

    We accept `Z` suffix and naive timestamps. Naive timestamps are treated as UTC.
    """
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class JobsWorker:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.worker_id = f"jobs-worker:{uuid4()}"
        self._shutdown = asyncio.Event()

    async def run_forever(self) -> None:
        logger.info(
            "Jobs worker starting",
            worker_id=self.worker_id,
            lease_seconds=self.settings.job_worker_lease_seconds,
        )

        reaper_task = asyncio.create_task(self._reap_expired_running_jobs())
        try:
            while not self._shutdown.is_set():
                try:
                    job = await claim_next_job(
                        worker_id=self.worker_id,
                        lease_seconds=self.settings.job_worker_lease_seconds,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to claim job (will retry)",
                        worker_id=self.worker_id,
                        error=str(exc),
                    )
                    await asyncio.sleep(self.settings.job_worker_poll_interval_seconds)
                    continue
                if not job:
                    await asyncio.sleep(self.settings.job_worker_poll_interval_seconds)
                    continue

                # Never crash the worker loop because of a single job.
                try:
                    await self._execute_claimed_job(job)
                except Exception as exc:
                    logger.error(
                        "Unhandled exception executing job",
                        worker_id=self.worker_id,
                        job_id=job.id,
                        job_type=job.job_type,
                        error=str(exc),
                    )
        finally:
            reaper_task.cancel()
            await asyncio.gather(reaper_task, return_exceptions=True)
            logger.info("Jobs worker stopped", worker_id=self.worker_id)

    async def shutdown(self) -> None:
        self._shutdown.set()

    async def _reap_expired_running_jobs(self) -> None:
        """
        Periodically requeue jobs stuck in 'running' with expired leases.

        This is essential for crash-only operation: if a worker dies mid-job,
        the lease expires and the job must become runnable again.
        """
        interval = max(5, int(self.settings.job_worker_reaper_interval_seconds))
        limit = int(max(1, self.settings.job_worker_reaper_limit))

        # Run once immediately on startup.
        while not self._shutdown.is_set():
            try:
                requeued = await requeue_expired_running_jobs(limit=limit)
                if requeued:
                    logger.warning(
                        "Requeued expired running jobs",
                        worker_id=self.worker_id,
                        count=requeued,
                    )
            except Exception as exc:
                logger.warning(
                    "Failed to requeue expired running jobs",
                    worker_id=self.worker_id,
                    error=str(exc),
                )

            await asyncio.sleep(interval)

    async def _execute_claimed_job(self, job: ClaimedJob) -> None:
        started_at = datetime.utcnow()
        logger.info(
            "Executing job",
            job_id=job.id,
            job_type=job.job_type,
            organization_id=job.organization_id,
            attempts=job.attempts,
            max_attempts=job.max_attempts,
        )

        lease_task = asyncio.create_task(self._lease_heartbeat(job.id))
        try:
            result = await self._dispatch(job)
            try:
                await mark_job_succeeded(job_id=job.id, result=result or {})
            except Exception as exc:
                # Do not crash the worker if we fail to update status. The reaper will
                # eventually make the job runnable again once the lease expires.
                logger.error(
                    "Failed to mark job succeeded",
                    worker_id=self.worker_id,
                    job_id=job.id,
                    job_type=job.job_type,
                    error=str(exc),
                )
            logger.info(
                "Job succeeded",
                job_id=job.id,
                job_type=job.job_type,
                duration_seconds=(datetime.utcnow() - started_at).total_seconds(),
            )
        except Exception as exc:
            backoff_seconds = compute_backoff_seconds(attempt=job.attempts)
            try:
                await mark_job_failed(
                    job_id=job.id,
                    error=str(exc),
                    attempts=job.attempts,
                    max_attempts=job.max_attempts,
                    backoff_seconds=backoff_seconds,
                )
            except Exception as mark_exc:
                # Best-effort: if we cannot update job state, keep the worker alive.
                logger.error(
                    "Failed to mark job failed",
                    worker_id=self.worker_id,
                    job_id=job.id,
                    job_type=job.job_type,
                    error=str(mark_exc),
                )
            logger.warning(
                "Job failed",
                job_id=job.id,
                job_type=job.job_type,
                attempts=job.attempts,
                max_attempts=job.max_attempts,
                backoff_seconds=backoff_seconds,
                error=str(exc),
            )
        finally:
            lease_task.cancel()
            await asyncio.gather(lease_task, return_exceptions=True)

    async def _dispatch(self, job: ClaimedJob) -> dict | None:
        if job.job_type == "connector.sync":
            return await self._run_connector_sync(job)
        if job.job_type == "connector.backfill_plan":
            return await self._run_connector_backfill_plan(job)
        if job.job_type == "webhook.outbox.flush":
            return await self._run_webhook_outbox_flush(job)
        if job.job_type == "candidates.process":
            return await self._run_candidates_process(job)
        if job.job_type == "reports.weekly":
            return await self._run_reports_weekly(job)
        if job.job_type == "reports.daily":
            return await self._run_reports_daily(job)
        if job.job_type == "memory.decay":
            return await self._run_memory_decay(job)
        if job.job_type == "evidence.retention":
            return await self._run_evidence_retention(job)

        raise ValueError(f"Unknown job_type: {job.job_type}")

    async def _lease_heartbeat(self, job_id: str) -> None:
        interval = max(5.0, self.settings.job_worker_lease_seconds / 3)
        while not self._shutdown.is_set():
            await asyncio.sleep(interval)
            try:
                ok = await extend_lease(
                    job_id=job_id,
                    worker_id=self.worker_id,
                    lease_seconds=self.settings.job_worker_lease_seconds,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to extend lease",
                    worker_id=self.worker_id,
                    job_id=job_id,
                    error=str(exc),
                )
                return
            if not ok:
                return

    async def _run_connector_sync(self, job: ClaimedJob) -> dict:
        from src.connectors.connection_service import get_connection_config
        from src.connectors.scheduling.scheduler import ConnectorScheduler, SyncJob, SyncJobType
        from src.db.rls import rls_context

        payload = job.payload
        connection_id = payload.get("connection_id")
        organization_id = payload.get("organization_id") or job.organization_id
        streams = payload.get("streams")
        full_refresh = bool(payload.get("full_refresh") or False)
        sync_params = payload.get("sync_params") or {}
        scheduled = bool(payload.get("scheduled") or False)
        sync_job_type_raw = payload.get("sync_job_type")
        backfill_start_raw = payload.get("backfill_start")
        backfill_end_raw = payload.get("backfill_end")

        if not connection_id or not organization_id:
            raise ValueError("connector.sync missing connection_id/organization_id")

        with rls_context(organization_id, is_internal=True):
            config = await get_connection_config(connection_id, organization_id)

        if not config:
            raise ValueError(f"Connection config not found: {connection_id}")

        scheduler = ConnectorScheduler()
        if sync_job_type_raw:
            try:
                sync_job_type = SyncJobType(str(sync_job_type_raw))
            except ValueError:
                raise ValueError(f"Invalid sync_job_type: {sync_job_type_raw}")
        elif backfill_start_raw or backfill_end_raw:
            sync_job_type = SyncJobType.BACKFILL
        else:
            sync_job_type = SyncJobType.SCHEDULED if scheduled else SyncJobType.ON_DEMAND

        backfill_start_date = (
            _parse_iso_datetime(str(backfill_start_raw)) if backfill_start_raw else None
        )
        backfill_end_date = (
            _parse_iso_datetime(str(backfill_end_raw)) if backfill_end_raw else None
        )

        sync_job = SyncJob(
            job_id=job.id,
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=config.connector_type,
            job_type=sync_job_type,
            streams=streams or [],
            full_refresh=full_refresh,
            backfill_start_date=backfill_start_date,
            backfill_end_date=backfill_end_date,
            sync_params=sync_params,
        )

        result = await scheduler._execute_sync(sync_job, config)
        return result.model_dump()

    async def _run_connector_backfill_plan(self, job: ClaimedJob) -> dict:
        from src.connectors.connection_service import get_connection_config
        from src.connectors.scheduling.backfill import (
            generate_backfill_windows,
            resolve_backfill_settings,
        )
        from src.db.rls import rls_context
        from src.jobs.queue import EnqueueJobRequest, enqueue_job

        payload = job.payload
        connection_id = payload.get("connection_id")
        organization_id = payload.get("organization_id") or job.organization_id
        start_date_raw = payload.get("start_date")
        end_date_raw = payload.get("end_date")
        window_days = payload.get("window_days")
        streams = payload.get("streams")
        throttle_seconds = payload.get("throttle_seconds")

        if not connection_id or not organization_id or not start_date_raw:
            raise ValueError("connector.backfill_plan missing required fields")

        start_date = _parse_iso_datetime(str(start_date_raw))
        end_date = _parse_iso_datetime(str(end_date_raw)) if end_date_raw else datetime.now(timezone.utc)

        with rls_context(organization_id, is_internal=True):
            config = await get_connection_config(connection_id, organization_id)

        if not config:
            raise ValueError(f"Connection not found: {connection_id}")

        resolved_window_days, resolved_throttle_seconds = resolve_backfill_settings(
            connector_type=config.connector_type,
            window_days=window_days,
            throttle_seconds=throttle_seconds,
            provider_config=config.provider_config,
        )

        windows = generate_backfill_windows(start_date, end_date, window_days=resolved_window_days)
        if not windows:
            return {"window_job_ids": []}

        now = datetime.now(timezone.utc)
        streams_list = list(streams) if isinstance(streams, list) else []
        streams_fingerprint = ",".join(streams_list) if streams_list else "*"

        window_job_ids: list[str] = []
        for idx, window in enumerate(windows, start=1):
            # Build a short deterministic idempotency key so re-running the plan
            # does not duplicate window jobs.
            key_material = f"backfill:{connection_id}:{window.start.isoformat()}:{window.end.isoformat()}:{streams_fingerprint}"
            idempotency_key = hashlib.sha256(key_material.encode("utf-8")).hexdigest()

            sync_params: dict[str, object] = {
                "backfill_start": window.start.isoformat(),
                "backfill_end": window.end.isoformat(),
                "backfill_window_index": idx,
                "backfill_window_total": len(windows),
            }

            # Apply optional spacing between windows (rate limiting) via run_at.
            run_at = now + timedelta(seconds=float(resolved_throttle_seconds) * (idx - 1))

            window_job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=organization_id,
                    job_type="connector.sync",
                    payload={
                        "connection_id": str(connection_id),
                        "organization_id": organization_id,
                        "streams": streams_list or None,
                        "full_refresh": True,
                        "scheduled": False,
                        "sync_job_type": "backfill",
                        "backfill_start": window.start.isoformat(),
                        "backfill_end": window.end.isoformat(),
                        "sync_params": sync_params,
                    },
                    priority=1,
                    run_at=run_at,
                    max_attempts=3,
                    idempotency_key=idempotency_key,
                    resource_key=f"connection:{connection_id}",
                )
            )
            window_job_ids.append(window_job_id)

        logger.info(
            "Backfill plan enqueued",
            connection_id=connection_id,
            organization_id=organization_id,
            window_count=len(window_job_ids),
            window_days=resolved_window_days,
            throttle_seconds=resolved_throttle_seconds,
        )
        return {"window_job_ids": window_job_ids}

    async def _run_webhook_outbox_flush(self, job: ClaimedJob) -> dict:
        from src.connectors.webhooks.outbox import flush_webhook_outbox

        limit = int((job.payload or {}).get("limit") or 100)
        published = await flush_webhook_outbox(limit=limit)
        return {"published": int(published), "limit": limit}

    async def _run_candidates_process(self, job: ClaimedJob) -> dict:
        from src.candidates.processor import process_signal_candidates

        limit = int((job.payload or {}).get("limit") or 200)
        result = await process_signal_candidates(limit=limit)
        return {"limit": limit, **(result or {})}

    async def _run_reports_weekly(self, job: ClaimedJob) -> dict:
        from src.analytics.reporting import generate_weekly_reports

        payload = job.payload or {}
        pilot_only = bool(payload.get("pilot_only", True))
        brief_days = int(payload.get("brief_days") or 7)
        blindspot_days = int(payload.get("blindspot_days") or 30)
        result = await generate_weekly_reports(
            pilot_only=pilot_only,
            brief_days=brief_days,
            blindspot_days=blindspot_days,
        )
        return {
            "pilot_only": pilot_only,
            "brief_days": brief_days,
            "blindspot_days": blindspot_days,
            **(result or {}),
        }

    async def _run_reports_daily(self, job: ClaimedJob) -> dict:
        from src.analytics.reporting import generate_daily_reports

        payload = job.payload or {}
        pilot_only = bool(payload.get("pilot_only", True))
        brief_days = int(payload.get("brief_days") or 1)
        result = await generate_daily_reports(
            pilot_only=pilot_only,
            brief_days=brief_days,
        )
        return {"pilot_only": pilot_only, "brief_days": brief_days, **(result or {})}

    async def _run_memory_decay(self, job: ClaimedJob) -> dict:
        from src.jobs.decay import get_decay_job

        payload = job.payload or {}
        org_id = payload.get("organization_id")
        decay_job = await get_decay_job()
        result = await decay_job.run(organization_id=str(org_id) if org_id else None)
        return result or {}

    async def _run_evidence_retention(self, job: ClaimedJob) -> dict:
        from src.jobs.evidence_retention import get_retention_job

        payload = job.payload or {}
        org_id = payload.get("organization_id")
        dry_run = bool(payload.get("dry_run") or False)
        limit = int(payload.get("limit") or 500)
        retention_job = get_retention_job()
        result = await retention_job.run(
            organization_id=str(org_id) if org_id else None,
            dry_run=dry_run,
            limit=limit,
        )
        return result or {}


async def _run() -> None:
    await init_db()
    worker = JobsWorker()

    loop = asyncio.get_event_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(worker.shutdown()))
        except NotImplementedError:
            signal.signal(sig, lambda *_: asyncio.create_task(worker.shutdown()))

    try:
        await worker.run_forever()
    finally:
        await close_db_pool()
        await close_db()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
