"""
Durable Jobs Worker

Executes jobs from the Postgres-backed `background_job` queue.
This is the command plane (sync/backfill/reports/maintenance).
"""

from __future__ import annotations

import asyncio
import json
import hashlib
import signal
from datetime import date, datetime, timedelta, timezone
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


def _to_json_compatible(value):
    """Convert nested Python values to JSON-compatible primitives."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _to_json_compatible(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_json_compatible(item) for item in value]
    return str(value)

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


class JobDispatchError(Exception):
    """Raised by job handlers to signal retryable vs terminal failures."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class JobsWorker:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.worker_id = f"jobs-worker:{uuid4()}"
        self._shutdown = asyncio.Event()
        self._allowed_job_types = [
            str(item).strip()
            for item in (self.settings.job_worker_allowed_job_types or [])
            if item is not None and str(item).strip()
        ]

    async def run_forever(self) -> None:
        logger.info(
            "Jobs worker starting",
            worker_id=self.worker_id,
            lease_seconds=self.settings.job_worker_lease_seconds,
            allowed_job_type_count=len(self._allowed_job_types),
            allowed_job_types=self._allowed_job_types,
        )

        reaper_task = asyncio.create_task(self._reap_expired_running_jobs())
        try:
            while not self._shutdown.is_set():
                try:
                    job = await claim_next_job(
                        worker_id=self.worker_id,
                        lease_seconds=self.settings.job_worker_lease_seconds,
                        allowed_job_types=self._allowed_job_types or None,
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
            safe_result = _to_json_compatible(result or {})
            json.dumps(safe_result)  # Guardrail: fail fast if not JSON serializable.
            try:
                await mark_job_succeeded(job_id=job.id, result=safe_result)
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
            retryable = not isinstance(exc, JobDispatchError) or bool(exc.retryable)
            backoff_seconds = compute_backoff_seconds(attempt=job.attempts)
            attempts_for_failure = int(job.attempts)
            if not retryable:
                attempts_for_failure = int(job.max_attempts)
                backoff_seconds = 0
            try:
                await mark_job_failed(
                    job_id=job.id,
                    error=str(exc),
                    attempts=attempts_for_failure,
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
                retryable=retryable,
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
        if job.job_type == "connectors.health_monitor":
            return await self._run_connectors_health_monitor(job)
        if job.job_type == "crawl.frontier.tick":
            return await self._run_crawl_frontier_tick(job)
        if job.job_type == "crawl.fetch":
            return await self._run_crawl_fetch(job)
        if job.job_type == "crawl.parse":
            return await self._run_crawl_parse(job)
        if job.job_type == "crawl.diff":
            return await self._run_crawl_diff(job)
        if job.job_type == "lakehouse.backfill":
            return await self._run_lakehouse_backfill(job)
        if job.job_type == "lakehouse.replay":
            return await self._run_lakehouse_replay(job)
        if job.job_type == "lakehouse.quality":
            return await self._run_lakehouse_quality(job)
        if job.job_type == "lakehouse.retention":
            return await self._run_lakehouse_retention(job)
        if job.job_type == "lakehouse.lifecycle":
            return await self._run_lakehouse_lifecycle(job)
        if job.job_type == "source.reliability.calibrate":
            return await self._run_source_reliability_calibration(job)
        if job.job_type == "learning.feedback.ingest":
            return await self._run_learning_feedback_ingest(job)
        if job.job_type == "learning.recalibrate":
            return await self._run_learning_recalibrate(job)
        if job.job_type == "mlops.shadow.evaluate":
            return await self._run_mlops_shadow_evaluate(job)
        if job.job_type == "mlops.canary.evaluate":
            return await self._run_mlops_canary_evaluate(job)
        if job.job_type == "hypothesis.generate":
            return await self._run_hypothesis_generate(job)
        if job.job_type == "hypothesis.rescore":
            return await self._run_hypothesis_rescore(job)
        if job.job_type == "normative.sentinel":
            return await self._run_normative_sentinel(job)
        if job.job_type == "simulation.run":
            return await self._run_simulation(job)
        if job.job_type == "intervention.propose":
            return await self._run_intervention_propose(job)
        if job.job_type == "intervention.outcome.capture":
            return await self._run_intervention_capture_outcome(job)
        if job.job_type == "impact.compute":
            return await self._run_impact_compute(job)
        if job.job_type == "world_twin.snapshot":
            return await self._run_world_twin_snapshot(job)
        if job.job_type == "world_twin.stream_update":
            return await self._run_world_twin_stream_update(job)
        if job.job_type == "world_twin.prematerialize":
            return await self._run_world_twin_prematerialize(job)
        if job.job_type == "system.noop":
            # Internal diagnostic job used for integration smoke tests and ops verification.
            return {"ok": True}
        if job.job_type == "webhook.outbox.flush":
            return await self._run_webhook_outbox_flush(job)
        if job.job_type == "candidates.process":
            return await self._run_candidates_process(job)
        if job.job_type == "reports.weekly":
            return await self._run_reports_weekly(job)
        if job.job_type == "reports.weekly_operations":
            return await self._run_reports_weekly_operations(job)
        if job.job_type == "reports.daily":
            return await self._run_reports_daily(job)
        if job.job_type == "trust.integrity_monthly":
            return await self._run_monthly_integrity_reports(job)
        if job.job_type == "memory.decay":
            return await self._run_memory_decay(job)
        if job.job_type == "evidence.retention":
            return await self._run_evidence_retention(job)
        if job.job_type == "custody.daily_root":
            return await self._run_custody_daily_root(job)
        if job.job_type == "documents.process":
            return await self._run_documents_process(job)
        if job.job_type == "indexes.outbox.drain":
            return await self._run_outbox_drain(job)

        raise ValueError(f"Unknown job_type: {job.job_type}")

    async def _run_outbox_drain(self, job: ClaimedJob) -> dict:
        """
        Drain and process a batch of outbox events.

        This is the bridge between canonical truth writes and derived indexes.
        """
        from src.graph.client import get_graph_client
        from src.jobs.outbox import (
            claim_outbox_events,
            mark_outbox_failed,
            mark_outbox_succeeded,
        )
        from src.db.rls import rls_context
        from src.contexts.uio_truth.infrastructure.derived_indexer import process_outbox_event

        payload = job.payload or {}
        limit = int(payload.get("limit") or 200)
        limit = max(1, min(limit, 2000))

        lease_seconds = int(payload.get("lease_seconds") or self.settings.job_worker_lease_seconds)
        lease_seconds = max(30, int(lease_seconds))

        events = await claim_outbox_events(
            worker_id=self.worker_id,
            lease_seconds=lease_seconds,
            limit=limit,
        )

        if not events:
            return {"processed": 0, "succeeded": 0, "failed": 0}

        graph = await get_graph_client()

        processed = 0
        succeeded = 0
        failed = 0

        for event in events:
            processed += 1
            try:
                with rls_context(event.organization_id, is_internal=True):
                    await process_outbox_event(
                        graph=graph,
                        event_type=event.event_type,
                        payload=event.payload,
                    )

                await mark_outbox_succeeded(event_id=event.id, worker_id=self.worker_id)
                succeeded += 1
            except Exception as exc:
                await mark_outbox_failed(
                    event_id=event.id,
                    error=str(exc),
                    attempts=event.attempts,
                    max_attempts=event.max_attempts,
                )
                failed += 1

        return {"processed": processed, "succeeded": succeeded, "failed": failed}

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
        from src.connectors.scheduling.cadence_registry import (
            is_world_source_connector,
            resolve_freshness_slo_minutes,
        )
        from src.connectors.scheduling.checkpoints import extract_checkpoint_watermark
        from src.connectors.scheduling.retry_policy import classify_failure
        from src.connectors.scheduling.run_ledger import (
            SourceSyncRunStart,
            count_recent_failed_runs,
            create_source_sync_run,
            finalize_source_sync_run,
        )
        from src.connectors.degradation import (
            DegradationMode,
            apply_degradation_sync_params,
            derive_degradation_mode,
        )
        from src.connectors.http import get_connector_circuit_breaker_snapshot
        from src.lakehouse.writer import write_lake_record
        from src.ops.adaptive_throttle import (
            apply_adaptive_throttle_sync_params,
            derive_adaptive_throttle,
        )
        from src.connectors.scheduling.scheduler import (
            ConnectorScheduler,
            SyncJob,
            SyncJobStatus,
            SyncJobType,
        )
        from src.connectors.state_repo import get_state_repo
        from src.db.client import get_db_session
        from src.db.models.connections import Connection
        from src.db.rls import rls_context
        from sqlalchemy import select

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

        is_world_source = is_world_source_connector(config.connector_type)
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

        scheduled_interval_minutes = (
            self._coerce_int(sync_params.get("scheduled_interval_minutes"))
            or self._coerce_int(config.sync_frequency_minutes)
        )
        freshness_slo_minutes = resolve_freshness_slo_minutes(
            config.connector_type,
            fallback=int(self.settings.connector_health_sync_slo_minutes),
        )
        freshness_lag_minutes = self._compute_freshness_lag_minutes(config.last_sync_at)
        quota_headroom_ratio = self._resolve_quota_headroom(sync_params, config.provider_config)
        voi_priority = self._resolve_voi_priority(sync_params, config.provider_config)
        queue_depth_ratio = self._resolve_queue_depth_ratio(sync_params, config.provider_config)
        provider_open_types = {
            key.split("provider:", 1)[1]
            for key, value in get_connector_circuit_breaker_snapshot().items()
            if key.startswith("provider:") and bool((value or {}).get("is_open"))
        }
        degradation = derive_degradation_mode(
            provider_circuit_open=str(config.connector_type) in provider_open_types,
            quota_headroom_ratio=quota_headroom_ratio,
            freshness_lag_minutes=freshness_lag_minutes,
            freshness_slo_minutes=freshness_slo_minutes,
        )
        adaptive_throttle = derive_adaptive_throttle(
            voi_priority=voi_priority,
            freshness_lag_minutes=freshness_lag_minutes,
            freshness_slo_minutes=freshness_slo_minutes,
            queue_depth_ratio=queue_depth_ratio,
            degradation_throttle_multiplier=float(degradation.throttle_multiplier),
        )

        state_repo = get_state_repo()
        state_before = await state_repo.get_state(connection_id, config.connector_type)
        checkpoint_before = self._state_to_checkpoint_map(state_before)
        watermark_before = self._max_checkpoint_watermark(
            checkpoint_map=checkpoint_before,
            extractor=extract_checkpoint_watermark,
        )

        sync_params = dict(sync_params or {})
        sync_params.setdefault("scheduled_interval_minutes", scheduled_interval_minutes)
        sync_params.setdefault("freshness_lag_minutes", freshness_lag_minutes)
        sync_params.setdefault("voi_priority", voi_priority)
        sync_params.setdefault("quota_headroom_ratio", quota_headroom_ratio)
        sync_params.setdefault("queue_depth_ratio", queue_depth_ratio)
        sync_params.setdefault("run_kind", sync_job_type.value)
        sync_params.setdefault("checkpoint_contract_version", 1)
        sync_params = apply_degradation_sync_params(sync_params=sync_params, decision=degradation)
        sync_params = apply_adaptive_throttle_sync_params(
            sync_params=sync_params,
            decision=adaptive_throttle,
        )

        source_sync_run_id = await create_source_sync_run(
            SourceSyncRunStart(
                organization_id=str(organization_id),
                connection_id=str(connection_id),
                connector_type=str(config.connector_type),
                run_kind=sync_job_type.value,
                started_at=datetime.now(timezone.utc),
                scheduled_interval_minutes=scheduled_interval_minutes,
                freshness_lag_minutes=freshness_lag_minutes,
                quota_headroom_ratio=quota_headroom_ratio,
                voi_priority=voi_priority,
                checkpoint_before=checkpoint_before,
                watermark_before=watermark_before,
                metadata={
                    "job_id": str(job.id),
                    "worker_id": self.worker_id,
                    "scheduled": bool(scheduled),
                    "streams_requested": list(streams or []),
                    "full_refresh": full_refresh,
                    "degradation": degradation.to_dict(),
                    "adaptive_throttle": adaptive_throttle.to_dict(),
                },
            )
        )
        sync_params["source_sync_run_id"] = source_sync_run_id

        if is_world_source:
            if (
                degradation.mode == DegradationMode.PROVIDER_OUTAGE
                and sync_job_type != SyncJobType.ON_DEMAND
            ):
                await finalize_source_sync_run(
                    run_id=source_sync_run_id,
                    status="degraded",
                    records_synced=0,
                    bytes_synced=0,
                    cost_units=0.0,
                    retry_class="provider_outage",
                    checkpoint_after=checkpoint_before,
                    watermark_after=watermark_before,
                    metadata_patch={
                        "deferred": True,
                        "degradation": degradation.to_dict(),
                        "adaptive_throttle": adaptive_throttle.to_dict(),
                    },
                )
                return {
                    "status": "degraded",
                    "reason": degradation.reason,
                    "degradation_mode": degradation.mode.value,
                    "adaptive_throttle": adaptive_throttle.to_dict(),
                    "source_sync_run_id": source_sync_run_id,
                }
            # Quarantined sources remain paused until the quarantine window expires.
            async with get_db_session() as session:
                connection_record = (
                    await session.execute(
                        select(Connection).where(Connection.id == connection_id)
                    )
                ).scalar_one_or_none()
            if connection_record:
                ingest_control = self._extract_ingest_control(connection_record.config)
                if self._is_quarantine_active(ingest_control):
                    quarantine_until = ingest_control.get("quarantined_until")
                    await finalize_source_sync_run(
                        run_id=source_sync_run_id,
                        status="quarantined",
                        records_synced=0,
                        bytes_synced=0,
                        cost_units=0.0,
                        retry_class=ingest_control.get("retry_class"),
                        checkpoint_after=checkpoint_before,
                        watermark_after=watermark_before,
                        metadata_patch={
                            "quarantine_reason": ingest_control.get("reason"),
                            "quarantined_until": quarantine_until,
                            "adaptive_throttle": adaptive_throttle.to_dict(),
                        },
                    )
                    return {
                        "status": "quarantined",
                        "source_sync_run_id": source_sync_run_id,
                        "quarantined_until": quarantine_until,
                    }

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
        state_after = await state_repo.get_state(connection_id, config.connector_type)
        checkpoint_after = self._state_to_checkpoint_map(state_after)
        watermark_after = self._max_checkpoint_watermark(
            checkpoint_map=checkpoint_after,
            extractor=extract_checkpoint_watermark,
        )

        if result.status == SyncJobStatus.COMPLETED:
            await finalize_source_sync_run(
                run_id=source_sync_run_id,
                status="succeeded",
                records_synced=result.records_synced,
                bytes_synced=result.bytes_synced,
                cost_units=self._estimate_ingest_cost(
                    records_synced=result.records_synced,
                    bytes_synced=result.bytes_synced,
                ),
                retry_class=None,
                checkpoint_after=checkpoint_after,
                watermark_after=watermark_after,
                metadata_patch={
                    "duration_seconds": result.duration_seconds,
                    "freshness_slo_minutes": freshness_slo_minutes,
                    "degradation": degradation.to_dict(),
                    "adaptive_throttle": adaptive_throttle.to_dict(),
                },
            )
            if is_world_source:
                await self._clear_connection_quarantine(connection_id)
            try:
                now_ts = datetime.now(timezone.utc)
                connector_source_key = str(config.connector_type or "connector_sync")
                await write_lake_record(
                    table_name="bronze.raw_observations",
                    schema_version="1.0",
                    organization_id=organization_id,
                    source_key=connector_source_key,
                    record_key=f"source_sync_run:{source_sync_run_id}",
                    event_time=now_ts,
                    payload={
                        "record_key": f"source_sync_run:{source_sync_run_id}",
                        "organization_id": organization_id,
                        "source_key": connector_source_key,
                        "event_time": now_ts.isoformat(),
                        "payload": {
                            "connection_id": str(connection_id),
                            "sync_job_type": sync_job_type.value,
                            "status": "succeeded",
                            "records_synced": result.records_synced,
                            "bytes_synced": result.bytes_synced,
                            "duration_seconds": result.duration_seconds,
                        },
                        "metadata": {
                            "source_sync_run_id": source_sync_run_id,
                            "scheduled_interval_minutes": scheduled_interval_minutes,
                        },
                    },
                    idempotency_key=f"source_sync_run:{source_sync_run_id}:succeeded",
                    metadata={"pipeline_stage": "connector.sync"},
                )
            except Exception as exc:
                logger.warning(
                    "Lakehouse bronze write failed for connector sync success",
                    connection_id=connection_id,
                    source_sync_run_id=source_sync_run_id,
                    error=str(exc),
                )
            payload = result.model_dump()
            payload["source_sync_run_id"] = source_sync_run_id
            return payload

        failure = classify_failure(result.error_message)
        await finalize_source_sync_run(
            run_id=source_sync_run_id,
            status="failed",
            records_synced=result.records_synced,
            bytes_synced=result.bytes_synced,
            cost_units=self._estimate_ingest_cost(
                records_synced=result.records_synced,
                bytes_synced=result.bytes_synced,
            ),
            retry_class=failure.retry_class.value,
            checkpoint_after=checkpoint_after,
            watermark_after=watermark_after,
                metadata_patch={
                    "duration_seconds": result.duration_seconds,
                    "error_message": result.error_message,
                    "freshness_slo_minutes": freshness_slo_minutes,
                    "degradation": degradation.to_dict(),
                    "adaptive_throttle": adaptive_throttle.to_dict(),
                },
        )

        if is_world_source:
            recent_failures = await count_recent_failed_runs(
                connection_id=str(connection_id),
                within_minutes=int(self.settings.world_ingest_quarantine_failure_window_minutes),
            )
            threshold = int(self.settings.world_ingest_quarantine_failure_threshold)
            if recent_failures >= threshold:
                await self._apply_connection_quarantine(
                    connection_id=str(connection_id),
                    retry_class=failure.retry_class.value,
                    reason=result.error_message or "Repeated sync failures",
                    failure_count=recent_failures,
                )

        try:
            now_ts = datetime.now(timezone.utc)
            connector_source_key = str(config.connector_type or "connector_sync")
            await write_lake_record(
                table_name="bronze.raw_observations",
                schema_version="1.0",
                organization_id=organization_id,
                source_key=connector_source_key,
                record_key=f"source_sync_run:{source_sync_run_id}",
                event_time=now_ts,
                payload={
                    "record_key": f"source_sync_run:{source_sync_run_id}",
                    "organization_id": organization_id,
                    "source_key": connector_source_key,
                    "event_time": now_ts.isoformat(),
                    "payload": {
                        "connection_id": str(connection_id),
                        "sync_job_type": sync_job_type.value,
                        "status": "failed",
                        "retry_class": failure.retry_class.value,
                        "error_message": result.error_message,
                        "records_synced": result.records_synced,
                        "bytes_synced": result.bytes_synced,
                    },
                    "metadata": {
                        "source_sync_run_id": source_sync_run_id,
                        "scheduled_interval_minutes": scheduled_interval_minutes,
                    },
                },
                idempotency_key=f"source_sync_run:{source_sync_run_id}:failed",
                metadata={"pipeline_stage": "connector.sync"},
            )
        except Exception as exc:
            logger.warning(
                "Lakehouse bronze write failed for connector sync failure",
                connection_id=connection_id,
                source_sync_run_id=source_sync_run_id,
                error=str(exc),
            )

        raise JobDispatchError(
            f"connector.sync failed [{failure.retry_class.value}]: {result.error_message or 'unknown'}",
            retryable=failure.retryable,
        )

    def _coerce_int(self, value: object) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _state_to_checkpoint_map(self, state) -> dict[str, dict]:
        checkpoints: dict[str, dict] = {}
        for stream_name, stream_state in (state.stream_states or {}).items():
            checkpoints[str(stream_name)] = dict(stream_state.cursor or {})
        return checkpoints

    def _max_checkpoint_watermark(self, *, checkpoint_map: dict[str, dict], extractor):
        latest = None
        for cursor in checkpoint_map.values():
            watermark = extractor(cursor)
            if watermark is None:
                continue
            if latest is None or watermark > latest:
                latest = watermark
        return latest

    def _compute_freshness_lag_minutes(self, last_sync_at: datetime | None) -> int:
        if last_sync_at is None:
            return 10_000
        if last_sync_at.tzinfo is None:
            last_sync = last_sync_at.replace(tzinfo=timezone.utc)
        else:
            last_sync = last_sync_at.astimezone(timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - last_sync).total_seconds() // 60))

    def _resolve_quota_headroom(
        self,
        sync_params: dict[str, object],
        provider_config: dict[str, object] | None,
    ) -> float | None:
        raw = sync_params.get("quota_headroom_ratio")
        if raw is None and isinstance(provider_config, dict):
            settings = provider_config.get("settings")
            if isinstance(settings, dict):
                raw = settings.get("quota_headroom_ratio")
        try:
            if raw is None:
                return None
            value = float(raw)
            return max(0.0, min(value, 1.0))
        except Exception:
            return None

    def _resolve_voi_priority(
        self,
        sync_params: dict[str, object],
        provider_config: dict[str, object] | None,
    ) -> float | None:
        raw = sync_params.get("voi_priority")
        if raw is None and isinstance(provider_config, dict):
            settings = provider_config.get("settings")
            if isinstance(settings, dict):
                raw = settings.get("voi_priority")
        try:
            if raw is None:
                return None
            value = float(raw)
            return max(0.0, min(value, 1.0))
        except Exception:
            return None

    def _resolve_queue_depth_ratio(
        self,
        sync_params: dict[str, object],
        provider_config: dict[str, object] | None,
    ) -> float | None:
        raw = sync_params.get("queue_depth_ratio")
        if raw is None and isinstance(provider_config, dict):
            settings = provider_config.get("settings")
            if isinstance(settings, dict):
                raw = settings.get("queue_depth_ratio")
        try:
            if raw is None:
                return None
            value = float(raw)
            return max(0.0, min(value, 1.0))
        except Exception:
            return None

    def _estimate_ingest_cost(self, *, records_synced: int, bytes_synced: int) -> float:
        records_cost = max(float(records_synced), 0.0) / 1000.0
        bytes_cost = max(float(bytes_synced), 0.0) / float(5 * 1024 * 1024)
        return round(records_cost + bytes_cost, 6)

    def _extract_ingest_control(self, config_payload: dict | None) -> dict[str, object]:
        config = config_payload if isinstance(config_payload, dict) else {}
        ingest = config.get("ingest_control")
        return ingest if isinstance(ingest, dict) else {}

    def _is_quarantine_active(self, ingest_control: dict[str, object]) -> bool:
        raw = ingest_control.get("quarantined_until")
        if not raw:
            return False
        try:
            text = str(raw)
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            until = datetime.fromisoformat(text)
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            else:
                until = until.astimezone(timezone.utc)
            return until > datetime.now(timezone.utc)
        except Exception:
            return False

    async def _clear_connection_quarantine(self, connection_id: str) -> None:
        from sqlalchemy import select

        from src.db.client import get_db_session
        from src.db.models.connections import Connection

        async with get_db_session() as session:
            connection = (
                await session.execute(select(Connection).where(Connection.id == connection_id))
            ).scalar_one_or_none()
            if not connection:
                return
            config = connection.config if isinstance(connection.config, dict) else {}
            ingest_control = config.get("ingest_control")
            if not isinstance(ingest_control, dict):
                return
            if "quarantined_until" not in ingest_control:
                return
            config["ingest_control"] = {
                **ingest_control,
                "quarantined_until": None,
                "failure_count": 0,
            }
            connection.config = config
            if connection.status == "paused":
                connection.status = "active"
            connection.sync_enabled = True
            connection.updated_at = datetime.utcnow()
            await session.commit()

    async def _apply_connection_quarantine(
        self,
        *,
        connection_id: str,
        retry_class: str,
        reason: str,
        failure_count: int,
    ) -> None:
        from sqlalchemy import select

        from src.db.client import get_db_session
        from src.db.models.connections import Connection

        quarantine_until = datetime.now(timezone.utc) + timedelta(
            minutes=int(self.settings.world_ingest_quarantine_duration_minutes)
        )

        async with get_db_session() as session:
            connection = (
                await session.execute(select(Connection).where(Connection.id == connection_id))
            ).scalar_one_or_none()
            if not connection:
                return

            config = connection.config if isinstance(connection.config, dict) else {}
            existing = config.get("ingest_control")
            ingest_control = existing if isinstance(existing, dict) else {}
            config["ingest_control"] = {
                **ingest_control,
                "quarantined_until": quarantine_until.isoformat(),
                "retry_class": retry_class,
                "reason": str(reason)[:500],
                "failure_count": int(failure_count),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

            connection.config = config
            connection.sync_enabled = False
            connection.status = "paused"
            connection.updated_at = datetime.utcnow()
            await session.commit()

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

    async def _run_connectors_health_monitor(self, job: ClaimedJob) -> dict:
        from src.connectors.health_monitor import run_connectors_health_monitor

        payload = job.payload or {}
        return await run_connectors_health_monitor(payload)

    async def _run_crawl_frontier_tick(self, job: ClaimedJob) -> dict:
        from src.crawlers.pipeline import run_crawl_frontier_tick

        payload = job.payload or {}
        sync_params = payload.get("sync_params")
        if not isinstance(sync_params, dict):
            sync_params = {}
        return await run_crawl_frontier_tick(sync_params=sync_params)

    async def _run_crawl_fetch(self, job: ClaimedJob) -> dict:
        from src.crawlers.pipeline import run_crawl_fetch_stage

        payload = job.payload or {}
        frontier_entry_id = payload.get("frontier_entry_id")
        if not frontier_entry_id:
            raise ValueError("crawl.fetch missing frontier_entry_id")
        sync_params = payload.get("sync_params")
        if not isinstance(sync_params, dict):
            sync_params = {}
        return await run_crawl_fetch_stage(
            frontier_entry_id=str(frontier_entry_id),
            sync_params=sync_params,
        )

    async def _run_crawl_parse(self, job: ClaimedJob) -> dict:
        from src.crawlers.pipeline import run_crawl_parse_stage

        payload = job.payload or {}
        snapshot_id = payload.get("snapshot_id")
        if not snapshot_id:
            raise ValueError("crawl.parse missing snapshot_id")
        return await run_crawl_parse_stage(snapshot_id=str(snapshot_id))

    async def _run_crawl_diff(self, job: ClaimedJob) -> dict:
        from src.crawlers.pipeline import run_crawl_diff_stage

        payload = job.payload or {}
        snapshot_id = payload.get("snapshot_id")
        if not snapshot_id:
            raise ValueError("crawl.diff missing snapshot_id")
        return await run_crawl_diff_stage(snapshot_id=str(snapshot_id))

    async def _run_lakehouse_backfill(self, job: ClaimedJob) -> dict:
        from src.lakehouse.jobs import run_lakehouse_backfill

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id)
        start_time = payload.get("start_time")
        end_time = payload.get("end_time")
        if not organization_id or not start_time or not end_time:
            raise ValueError("lakehouse.backfill missing organization_id/start_time/end_time")
        start_dt = _parse_iso_datetime(str(start_time))
        end_dt = _parse_iso_datetime(str(end_time))
        source_key = str(payload.get("source_key") or "backfill")
        return await run_lakehouse_backfill(
            organization_id=organization_id,
            start_time=start_dt,
            end_time=end_dt,
            source_key=source_key,
        )

    async def _run_lakehouse_replay(self, job: ClaimedJob) -> dict:
        from src.lakehouse.jobs import run_lakehouse_replay

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id)
        checkpoint_key = str(payload.get("checkpoint_key") or "lakehouse_replay:event_records")
        max_events = int(payload.get("max_events") or 2000)
        return await run_lakehouse_replay(
            organization_id=organization_id,
            checkpoint_key=checkpoint_key,
            max_events=max_events,
        )

    async def _run_lakehouse_quality(self, job: ClaimedJob) -> dict:
        from src.lakehouse.jobs import run_lakehouse_quality

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id)
        table_name = payload.get("table_name")
        limit = int(payload.get("limit") or 500)
        return await run_lakehouse_quality(
            organization_id=organization_id,
            table_name=str(table_name) if table_name else None,
            limit=limit,
        )

    async def _run_lakehouse_retention(self, job: ClaimedJob) -> dict:
        from src.lakehouse.jobs import run_lakehouse_retention

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id)
        limit = int(payload.get("limit") or 5000)
        return await run_lakehouse_retention(
            organization_id=organization_id,
            limit=limit,
        )

    async def _run_lakehouse_lifecycle(self, job: ClaimedJob) -> dict:
        from src.lakehouse.jobs import run_lakehouse_lifecycle

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id)
        limit = int(payload.get("limit") or 5000)
        warm_after_days = int(payload.get("warm_after_days") or 7)
        cold_after_days = int(payload.get("cold_after_days") or 30)
        return await run_lakehouse_lifecycle(
            organization_id=organization_id,
            limit=limit,
            warm_after_days=warm_after_days,
            cold_after_days=cold_after_days,
        )

    async def _run_source_reliability_calibration(self, job: ClaimedJob) -> dict:
        from src.ingestion.reliability import calibrate_source_reliability_profiles

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "internal")
        lookback_days = int(payload.get("lookback_days") or self.settings.source_reliability_lookback_days)
        limit_sources = int(payload.get("limit_sources") or self.settings.source_reliability_limit_sources)
        return await calibrate_source_reliability_profiles(
            organization_id=organization_id,
            lookback_days=lookback_days,
            limit_sources=limit_sources,
        )

    async def _run_learning_feedback_ingest(self, job: ClaimedJob) -> dict:
        from src.learning import CorrectionEvent, LearningPipeline

        def _optional_float(value: object) -> float | None:
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        def _optional_int(value: object) -> int | None:
            if value is None:
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        payload = job.payload or {}
        raw_events = payload.get("events")
        if not isinstance(raw_events, list):
            raw_events = []
        if not raw_events:
            raise ValueError("learning.feedback.ingest missing events list")

        events: list[CorrectionEvent] = []
        for index, item in enumerate(raw_events):
            if not isinstance(item, dict):
                continue
            occurred_at_raw = item.get("occurred_at")
            occurred_at = (
                _parse_iso_datetime(str(occurred_at_raw))
                if occurred_at_raw
                else datetime.now(timezone.utc)
            )
            target_ref = item.get("target_ref") or item.get("object_ref")
            if not target_ref:
                continue
            events.append(
                CorrectionEvent(
                    event_id=str(item.get("event_id") or f"{job.id}:{index}"),
                    object_ref=str(target_ref),
                    source_key=str(item.get("source_key") or "unknown"),
                    event_type=str(item.get("event_type") or "user_correction"),
                    occurred_at=occurred_at,
                    predicted_probability=_optional_float(item.get("predicted_probability")),
                    corrected_outcome=_optional_int(item.get("corrected_outcome")),
                    metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
                )
            )

        if not events:
            raise ValueError("learning.feedback.ingest has no valid events")

        pipeline = LearningPipeline()
        result = pipeline.ingest_corrections(events)
        return result.to_dict()

    async def _run_learning_recalibrate(self, job: ClaimedJob) -> dict:
        from src.learning import LearningPipeline

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("learning.recalibrate missing organization_id")

        last_recalibration_raw = payload.get("last_recalibration_at")
        last_retrain_raw = payload.get("last_retrain_at")
        now_raw = payload.get("now")

        default_last = datetime.now(timezone.utc) - timedelta(days=7)
        last_recalibration_at = (
            _parse_iso_datetime(str(last_recalibration_raw))
            if isinstance(last_recalibration_raw, str) and last_recalibration_raw.strip()
            else default_last
        )
        last_retrain_at = (
            _parse_iso_datetime(str(last_retrain_raw))
            if isinstance(last_retrain_raw, str) and last_retrain_raw.strip()
            else default_last
        )
        now_dt = (
            _parse_iso_datetime(str(now_raw))
            if isinstance(now_raw, str) and now_raw.strip()
            else datetime.now(timezone.utc)
        )
        new_feedback_count = int(payload.get("new_feedback_count") or 0)

        pipeline = LearningPipeline()
        decision = pipeline.decide_retrain_cadence(
            last_recalibration_at=last_recalibration_at,
            last_retrain_at=last_retrain_at,
            new_feedback_count=new_feedback_count,
            now=now_dt,
        )
        jobs = pipeline.scheduled_jobs_for_decision(
            organization_id=organization_id,
            decision=decision,
        )

        return {
            "organization_id": organization_id,
            "new_feedback_count": new_feedback_count,
            "decision": decision.to_dict(),
            "scheduled_jobs": jobs,
        }

    async def _run_mlops_shadow_evaluate(self, job: ClaimedJob) -> dict:
        from src.mlops import ModelRegressionGate, ShadowDeploymentFramework

        payload = job.payload or {}
        baseline_outputs = payload.get("baseline_outputs")
        if not isinstance(baseline_outputs, list):
            baseline_outputs = []
        candidate_outputs = payload.get("candidate_outputs")
        if not isinstance(candidate_outputs, list):
            candidate_outputs = []
        expected_labels = payload.get("expected_labels")
        if not isinstance(expected_labels, list):
            expected_labels = None

        shadow = ShadowDeploymentFramework().evaluate(
            baseline_outputs=[item for item in baseline_outputs if isinstance(item, dict)],
            candidate_outputs=[item for item in candidate_outputs if isinstance(item, dict)],
            expected_labels=[int(item) for item in expected_labels] if expected_labels else None,
            max_disagreement_rate=float(payload.get("max_disagreement_rate") or 0.25),
        )
        gate = ModelRegressionGate().evaluate(
            {
                "accuracy": float(payload.get("accuracy") or 0.0),
                "calibration_error": float(payload.get("calibration_error") or 1.0),
                "latency_p95_ms": float(payload.get("latency_p95_ms") or 10_000.0),
            }
        )
        return {
            "shadow": shadow,
            "regression_gate": gate,
            "blocked": bool(gate.get("blocked")) or not bool(shadow.get("passed")),
        }

    async def _run_mlops_canary_evaluate(self, job: ClaimedJob) -> dict:
        from src.mlops import CalibrationMonitor, CanaryRolloutController, ModelSLADashboard

        def _to_float_map(value: object) -> dict[str, float]:
            if not isinstance(value, dict):
                return {}
            result: dict[str, float] = {}
            for key, item in value.items():
                try:
                    result[str(key)] = float(item)
                except (TypeError, ValueError):
                    continue
            return result

        payload = job.payload or {}
        baseline_metrics = payload.get("baseline_metrics")
        canary_metrics = payload.get("canary_metrics")

        rollout = CanaryRolloutController().evaluate_window(
            baseline_metrics=_to_float_map(baseline_metrics),
            canary_metrics=_to_float_map(canary_metrics),
            max_accuracy_drop=float(payload.get("max_accuracy_drop") or 0.03),
            max_latency_increase_ms=float(payload.get("max_latency_increase_ms") or 200.0),
            max_cost_increase_ratio=float(payload.get("max_cost_increase_ratio") or 0.3),
        )

        predictions = payload.get("prediction_outcomes")
        if not isinstance(predictions, list):
            predictions = []
        prediction_outcomes = [
            (float(item[0]), int(item[1]))
            for item in predictions
            if isinstance(item, list) and len(item) == 2
        ]
        calibration = CalibrationMonitor().monitor(
            prediction_outcomes=prediction_outcomes,
            alert_threshold=float(payload.get("calibration_alert_threshold") or 0.1),
        )

        events = payload.get("events")
        if not isinstance(events, list):
            events = []
        dashboard = ModelSLADashboard().summarize(
            events=[item for item in events if isinstance(item, dict)],
            latency_sla_ms=float(payload.get("latency_sla_ms") or 1500.0),
        )

        return {
            "rollout": rollout,
            "calibration": calibration,
            "dashboard": dashboard,
            "rollback": bool(rollout.get("rollback")) or bool(calibration.get("alert")),
        }

    async def _run_hypothesis_generate(self, job: ClaimedJob) -> dict:
        from src.hypothesis.service import get_hypothesis_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("hypothesis.generate missing organization_id")

        service = await get_hypothesis_service(organization_id)
        top_k = max(1, int(payload.get("top_k") or 3))
        min_score = float(payload.get("min_score") or 0.5)
        model_version = str(payload.get("model_version") or "hypothesis-v1")
        trigger = str(payload.get("trigger") or "worker")

        belief_id = payload.get("belief_id")
        contradiction_id = payload.get("contradiction_id")
        anomaly_ref = payload.get("anomaly_ref")

        if belief_id:
            contradiction_context = payload.get("contradiction_context")
            if contradiction_context is not None and not isinstance(contradiction_context, dict):
                contradiction_context = {}
            return await service.generate_for_belief(
                belief_id=str(belief_id),
                top_k=top_k,
                min_score=min_score,
                trigger=trigger,
                model_version=model_version,
                force_credible=bool(payload.get("force_credible") or False),
                contradiction_context=contradiction_context,
            )

        if contradiction_id:
            return await service.generate_for_contradiction(
                contradiction_id=str(contradiction_id),
                contradiction_type=str(payload.get("contradiction_type") or "conflict"),
                severity=str(payload.get("severity") or "high"),
                uio_a_id=str(payload.get("uio_a_id")) if payload.get("uio_a_id") else None,
                uio_b_id=str(payload.get("uio_b_id")) if payload.get("uio_b_id") else None,
                evidence_quote=str(payload.get("evidence_quote")) if payload.get("evidence_quote") else None,
                top_k=top_k,
                min_score=min_score,
                model_version=model_version,
            )

        if anomaly_ref:
            observations = payload.get("observations")
            if not isinstance(observations, list):
                observations = []
            contradiction_context = payload.get("contradiction_context")
            if contradiction_context is not None and not isinstance(contradiction_context, dict):
                contradiction_context = {}
            return await service.generate_for_anomaly(
                anomaly_ref=str(anomaly_ref),
                anomaly_summary=str(payload.get("anomaly_summary") or f"anomaly:{anomaly_ref}"),
                impact_score=float(payload.get("impact_score") or 0.6),
                observations=[str(item) for item in observations if item],
                top_k=top_k,
                min_score=min_score,
                trigger=trigger,
                model_version=model_version,
                contradiction_context=contradiction_context,
            )

        raise ValueError("hypothesis.generate missing belief_id, contradiction_id, or anomaly_ref")

    async def _run_hypothesis_rescore(self, job: ClaimedJob) -> dict:
        from src.hypothesis.service import get_hypothesis_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("hypothesis.rescore missing organization_id")

        service = await get_hypothesis_service(organization_id)
        evidence_signals = payload.get("evidence_signals")
        if not isinstance(evidence_signals, list):
            evidence_signals = []
        hypothesis_ids = payload.get("hypothesis_ids")
        if not isinstance(hypothesis_ids, list):
            hypothesis_ids = []

        return await service.rescore_hypotheses(
            belief_id=str(payload.get("belief_id")) if payload.get("belief_id") else None,
            hypothesis_ids=[str(item) for item in hypothesis_ids if item],
            evidence_signals=[item for item in evidence_signals if isinstance(item, dict)],
            model_version=str(payload.get("model_version") or "hypothesis-v1-rescore"),
            rejection_threshold=float(payload.get("rejection_threshold") or 0.45),
        )

    async def _run_normative_sentinel(self, job: ClaimedJob) -> dict:
        from src.normative.service import get_normative_intelligence_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("normative.sentinel missing organization_id")

        facts = payload.get("facts")
        if not isinstance(facts, dict):
            facts = {}

        service = await get_normative_intelligence_service(organization_id)
        return await service.run_violation_sentinel(
            facts=facts,
            include_warnings=bool(payload.get("include_warnings", True)),
            publish_events=bool(payload.get("publish_events", True)),
            max_constraints=int(payload.get("max_constraints") or 1000),
        )

    async def _run_simulation(self, job: ClaimedJob) -> dict:
        from src.simulation.engine import run_simulation
        from src.simulation.models import SimulationRequest

        payload = dict(job.payload or {})
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("simulation.run missing organization_id")
        payload["organization_id"] = organization_id

        request = SimulationRequest.model_validate(payload)
        result = await run_simulation(
            request,
            persist=bool(payload.get("persist", True)),
            publish_events=bool(payload.get("publish_events", True)),
            requested_by=str(payload.get("requested_by") or f"job:{job.id}"),
        )
        return result.model_dump(mode="json")

    async def _run_intervention_propose(self, job: ClaimedJob) -> dict:
        from src.intervention.service import get_intervention_service

        payload = dict(job.payload or {})
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("intervention.propose missing organization_id")

        service = await get_intervention_service(organization_id)
        actions = payload.get("recommended_actions")
        if not isinstance(actions, list):
            actions = []

        return await service.propose_and_persist(
            target_ref=str(payload.get("target_ref") or ""),
            pressure_score=float(payload.get("pressure_score") or 0.0),
            causal_confidence=float(payload.get("causal_confidence") or 0.0),
            max_constraint_severity=(
                str(payload.get("max_constraint_severity"))
                if payload.get("max_constraint_severity") is not None
                else None
            ),
            recommended_actions=[str(item) for item in actions if item],
            simulation_id=str(payload.get("simulation_id")) if payload.get("simulation_id") else None,
            persist=bool(payload.get("persist", True)),
            publish_events=bool(payload.get("publish_events", True)),
        )

    async def _run_intervention_capture_outcome(self, job: ClaimedJob) -> dict:
        from src.intervention.service import get_intervention_service

        payload = dict(job.payload or {})
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("intervention.outcome.capture missing organization_id")

        outcome_type = str(payload.get("outcome_type") or "").strip()
        if not outcome_type:
            raise ValueError("intervention.outcome.capture missing outcome_type")

        measured_at = payload.get("measured_at")
        measured = None
        if isinstance(measured_at, str) and measured_at.strip():
            measured = _parse_iso_datetime(measured_at)
        elif isinstance(measured_at, datetime):
            measured = measured_at

        outcome_payload = payload.get("outcome_payload")
        if not isinstance(outcome_payload, dict):
            outcome_payload = {}

        service = await get_intervention_service(organization_id)
        return await service.capture_outcome(
            outcome_type=outcome_type,
            outcome_payload=outcome_payload,
            intervention_plan_id=(
                str(payload.get("intervention_plan_id"))
                if payload.get("intervention_plan_id")
                else None
            ),
            measured_at=measured,
            persist=bool(payload.get("persist", True)),
            publish_events=bool(payload.get("publish_events", True)),
        )

    async def _run_impact_compute(self, job: ClaimedJob) -> dict:
        from src.world_model.service import get_impact_intelligence_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("impact.compute missing organization_id")

        external_events = payload.get("external_events")
        if not isinstance(external_events, list):
            external_events = []
        internal_objects = payload.get("internal_objects")
        if not isinstance(internal_objects, list):
            internal_objects = []
        risk_overlay = payload.get("risk_overlay")
        if not isinstance(risk_overlay, dict):
            risk_overlay = {}
        causal_strength_by_ref = payload.get("causal_strength_by_ref")
        if not isinstance(causal_strength_by_ref, dict):
            causal_strength_by_ref = {}

        service = await get_impact_intelligence_service(organization_id)
        persist = bool(payload.get("persist", True))
        if persist:
            return await service.compute_and_persist_impacts(
                internal_objects=internal_objects,
                external_events=external_events,
                risk_overlay=risk_overlay,
                causal_strength_by_ref=causal_strength_by_ref,
                min_score=float(payload.get("min_score") or 0.35),
                max_per_internal=int(payload.get("max_per_internal") or 3),
                max_total=int(payload.get("max_total") or 30),
                dedupe_window_minutes=int(payload.get("dedupe_window_minutes") or 240),
                publish_events=bool(payload.get("publish_events", True)),
            )

        return await service.preview_impacts(
            internal_objects=internal_objects,
            external_events=external_events,
            risk_overlay=risk_overlay,
            causal_strength_by_ref=causal_strength_by_ref,
            min_score=float(payload.get("min_score") or 0.35),
            max_per_internal=int(payload.get("max_per_internal") or 3),
            max_total=int(payload.get("max_total") or 30),
        )

    async def _run_world_twin_snapshot(self, job: ClaimedJob) -> dict:
        from src.world_model.twin_service import get_world_twin_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("world_twin.snapshot missing organization_id")

        service = await get_world_twin_service(organization_id)
        return await service.build_snapshot(
            lookback_hours=int(payload.get("lookback_hours") or (24 * 7)),
            role=str(payload.get("role") or "exec"),
            persist=bool(payload.get("persist", True)),
        )

    async def _run_world_twin_stream_update(self, job: ClaimedJob) -> dict:
        from src.world_model.twin_service import get_world_twin_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("world_twin.stream_update missing organization_id")

        event = payload.get("event")
        if not isinstance(event, dict):
            raise ValueError("world_twin.stream_update missing event payload")

        service = await get_world_twin_service(organization_id)
        return await service.apply_stream_event(
            event=event,
            persist=bool(payload.get("persist", True)),
        )

    async def _run_world_twin_prematerialize(self, job: ClaimedJob) -> dict:
        from src.world_model.twin_service import get_world_twin_service

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("world_twin.prematerialize missing organization_id")

        roles = payload.get("roles")
        if not isinstance(roles, list):
            roles = None
        lookback_hours = payload.get("lookback_hours")
        if not isinstance(lookback_hours, list):
            lookback_hours = None

        service = await get_world_twin_service(organization_id)
        return await service.pre_materialize_hot_queries(
            roles=[str(item) for item in roles] if roles else None,
            lookback_hours=[int(item) for item in lookback_hours] if lookback_hours else None,
        )

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

    async def _run_reports_weekly_operations(self, job: ClaimedJob) -> dict:
        from src.jobs.operational_reports import run_weekly_operations_briefs

        payload = job.payload or {}
        pilot_only = bool(payload.get("pilot_only", True))
        brief_days = int(payload.get("brief_days") or 7)
        blindspot_days = int(payload.get("blindspot_days") or 30)
        result = await run_weekly_operations_briefs(
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

    async def _run_monthly_integrity_reports(self, job: ClaimedJob) -> dict:
        from src.jobs.operational_reports import run_monthly_integrity_reports

        payload = job.payload or {}
        pilot_only = bool(payload.get("pilot_only", True))
        month = str(payload.get("month")).strip() if payload.get("month") else None
        result = await run_monthly_integrity_reports(
            pilot_only=pilot_only,
            month=month,
        )
        return {
            "pilot_only": pilot_only,
            "month": month,
            **(result or {}),
        }

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

    async def _run_custody_daily_root(self, job: ClaimedJob) -> dict:
        from datetime import date

        from sqlalchemy import text

        from src.db.client import get_db_session
        from src.jobs.custody_integrity import get_custody_integrity_job

        payload = job.payload or {}
        organization_id = str(payload.get("organization_id") or job.organization_id or "")
        if not organization_id:
            raise ValueError("custody.daily_root missing organization_id")

        root_date_raw = payload.get("root_date")
        root_date = date.fromisoformat(str(root_date_raw)) if root_date_raw else None

        custody_job = get_custody_integrity_job()
        if organization_id == "internal":
            async with get_db_session() as session:
                rows = await session.execute(
                    text("SELECT id FROM organization WHERE status = 'active'")
                )
                org_ids = [str(row.id) for row in rows.fetchall() if row.id]
            results: list[dict] = []
            for org_id in org_ids:
                result = await custody_job.run(
                    organization_id=org_id,
                    root_date=root_date,
                )
                results.append(result or {})
            return {"organization_count": len(results), "results": results}

        result = await custody_job.run(organization_id=organization_id, root_date=root_date)
        return result or {}

    async def _run_documents_process(self, job: ClaimedJob) -> dict:
        from src.documents.jobs import process_document_job

        payload = job.payload or {}
        organization_id = payload.get("organization_id") or job.organization_id
        document_id = payload.get("document_id")

        if not organization_id or not document_id:
            raise ValueError("documents.process missing organization_id/document_id")

        return await process_document_job(
            organization_id=str(organization_id),
            document_id=str(document_id),
        )


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
    from src.monitoring.prometheus_server import maybe_start_prometheus_http_server

    maybe_start_prometheus_http_server(component="drovi-jobs-worker")
    asyncio.run(_run())


if __name__ == "__main__":
    main()
