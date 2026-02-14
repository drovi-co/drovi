"""
Temporal Worker

Runs Temporal workflows and activities for Drovi orchestration.

This worker is the "workflow plane" (Temporal). It orchestrates durable jobs
in Postgres via activities that enqueue jobs into `background_job`.
"""

from __future__ import annotations

import asyncio
import signal
from datetime import timedelta

import structlog
from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.worker import Worker

from src.config import get_settings
from src.db.client import close_db, close_db_pool, init_db
from src.monitoring.prometheus_server import maybe_start_prometheus_http_server

from src.contexts.workflows.application.connector_backfill_workflow import (
    ConnectorBackfillWorkflow,
)
from src.contexts.workflows.application.agent_run_workflow import AgentRunWorkflow
from src.contexts.workflows.application.agent_team_monitor_workflow import AgentTeamMonitorWorkflow
from src.contexts.workflows.application.connector_sync_workflow import ConnectorSyncWorkflow
from src.contexts.workflows.application.connector_webhook_ingest_workflow import (
    ConnectorWebhookIngestWorkflow,
)
from src.contexts.workflows.application.diagnostics_workflow import DiagnosticsNoopWorkflow
from src.contexts.workflows.application.derived_index_build_workflow import (
    DerivedIndexBuildWorkflow,
)
from src.contexts.workflows.application.scheduled_sync_sweep_workflow import (
    ScheduledSyncSweepWorkflow,
)
from src.contexts.workflows.application.system_cron_workflows import (
    CandidatesProcessCronWorkflow,
    DailyReportsCronWorkflow,
    EvidenceRetentionCronWorkflow,
    IndexesOutboxDrainCronWorkflow,
    MemoryDecayCronWorkflow,
    WebhookOutboxFlushCronWorkflow,
    WeeklyReportsCronWorkflow,
)
from src.contexts.workflows.infrastructure.activities import (
    enqueue_background_job,
    get_background_job_snapshot,
    list_active_connections,
)
from src.contexts.workflows.infrastructure.agent_run_activities import (
    acquire_lane,
    acquire_org_slot,
    compensate_run,
    emit_run_event,
    enqueue_dead_letter,
    execute_step,
    record_run_step,
    release_lane,
    release_org_slot,
    update_run_status,
)
from src.contexts.workflows.infrastructure.agent_team_activities import (
    fetch_run_statuses,
    mark_runs_skipped,
    start_child_run,
)

logger = structlog.get_logger()


async def _ensure_system_cron_workflows(*, client: Client, task_queue: str) -> None:
    """
    Ensure the core "system cron" workflows exist.

    We use Temporal cron schedules to replace the old in-memory APScheduler process.
    """
    settings = get_settings()

    async def _start_once(
        *,
        workflow_run,
        workflow_id: str,
        cron_schedule: str,
        input_payload: dict[str, object] | None = None,
    ) -> None:
        try:
            await client.start_workflow(
                workflow_run,
                input_payload or {},
                id=workflow_id,
                task_queue=task_queue,
                cron_schedule=cron_schedule,
                execution_timeout=timedelta(days=3650),
            )
            logger.info(
                "Temporal cron workflow started",
                workflow_id=workflow_id,
                cron_schedule=cron_schedule,
            )
        except WorkflowAlreadyStartedError:
            return

    # Run the sweep frequently; the job plane idempotency key prevents duplicates.
    if settings.scheduler_scheduled_syncs_enabled:
        await _start_once(
            workflow_run=ScheduledSyncSweepWorkflow.run,
            workflow_id="cron:scheduled_sync_sweep",
            cron_schedule="* * * * *",
            input_payload={
                "default_interval_minutes": 5,
                "sweep_limit": 5000,
            },
        )

    if settings.derived_indexes_outbox_drain_enabled:
        await _start_once(
            workflow_run=IndexesOutboxDrainCronWorkflow.run,
            workflow_id="cron:indexes_outbox_drain",
            cron_schedule=str(settings.derived_indexes_outbox_drain_cron),
            input_payload={"limit": int(settings.derived_indexes_outbox_drain_limit)},
        )

    # Kafka-only: webhook outbox flush is only useful when streaming is enabled.
    if settings.kafka_enabled:
        await _start_once(
            workflow_run=WebhookOutboxFlushCronWorkflow.run,
            workflow_id="cron:webhook_outbox_flush",
            cron_schedule="* * * * *",
            input_payload={"limit": 100},
        )

    if settings.candidate_processing_enabled:
        # Temporal cron granularity is minutes; we enqueue idempotently per interval bucket.
        await _start_once(
            workflow_run=CandidatesProcessCronWorkflow.run,
            workflow_id="cron:candidates_process",
            cron_schedule="* * * * *",
            input_payload={
                "limit": 200,
                "interval_seconds": int(settings.candidate_processing_interval_seconds),
            },
        )

    if settings.weekly_reports_enabled:
        await _start_once(
            workflow_run=WeeklyReportsCronWorkflow.run,
            workflow_id="cron:reports_weekly",
            cron_schedule=str(settings.weekly_reports_cron),
            input_payload={
                "pilot_only": bool(settings.weekly_reports_pilot_only),
                "brief_days": int(settings.weekly_brief_days),
                "blindspot_days": int(settings.weekly_blindspot_days),
            },
        )

    if settings.daily_reports_enabled:
        await _start_once(
            workflow_run=DailyReportsCronWorkflow.run,
            workflow_id="cron:reports_daily",
            cron_schedule=str(settings.daily_reports_cron),
            input_payload={
                "pilot_only": bool(settings.daily_reports_pilot_only),
                "brief_days": int(settings.daily_brief_days),
            },
        )

    if settings.memory_decay_enabled:
        await _start_once(
            workflow_run=MemoryDecayCronWorkflow.run,
            workflow_id="cron:memory_decay",
            cron_schedule=str(settings.memory_decay_cron),
            input_payload={},
        )

    if settings.evidence_retention_cleanup_enabled:
        await _start_once(
            workflow_run=EvidenceRetentionCronWorkflow.run,
            workflow_id="cron:evidence_retention",
            cron_schedule=str(settings.evidence_retention_cleanup_cron),
            input_payload={"limit": int(settings.evidence_retention_cleanup_limit)},
        )


async def _run() -> None:
    settings = get_settings()
    if not settings.temporal_enabled:
        logger.warning(
            "Temporal worker started with TEMPORAL_ENABLED=false; idling",
            temporal_enabled=settings.temporal_enabled,
        )
        await asyncio.Event().wait()
        return

    await init_db()

    client = await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
    )

    # Start system cron workflows before starting the worker so the first run can be picked
    # up immediately when the worker begins polling.
    await _ensure_system_cron_workflows(
        client=client,
        task_queue=settings.temporal_task_queue,
    )

    stop_event = asyncio.Event()

    def _handle_signal(*_args) -> None:
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop_event.set())

    workflows = [
        AgentRunWorkflow,
        AgentTeamMonitorWorkflow,
        ConnectorSyncWorkflow,
        ConnectorBackfillWorkflow,
        ConnectorWebhookIngestWorkflow,
        DiagnosticsNoopWorkflow,
        DerivedIndexBuildWorkflow,
        ScheduledSyncSweepWorkflow,
        WebhookOutboxFlushCronWorkflow,
        CandidatesProcessCronWorkflow,
        WeeklyReportsCronWorkflow,
        DailyReportsCronWorkflow,
        MemoryDecayCronWorkflow,
        EvidenceRetentionCronWorkflow,
        IndexesOutboxDrainCronWorkflow,
    ]
    activities = [
        update_run_status,
        record_run_step,
        acquire_lane,
        acquire_org_slot,
        release_lane,
        release_org_slot,
        execute_step,
        compensate_run,
        enqueue_dead_letter,
        emit_run_event,
        start_child_run,
        fetch_run_statuses,
        mark_runs_skipped,
        enqueue_background_job,
        get_background_job_snapshot,
        list_active_connections,
    ]

    logger.info(
        "Temporal worker starting",
        temporal_address=settings.temporal_address,
        temporal_namespace=settings.temporal_namespace,
        temporal_task_queue=settings.temporal_task_queue,
        workflow_count=len(workflows),
        activity_count=len(activities),
    )

    try:
        async with Worker(
            client,
            task_queue=settings.temporal_task_queue,
            workflows=workflows,
            activities=activities,
        ):
            await stop_event.wait()
    finally:
        await client.close()
        await close_db_pool()
        await close_db()
        logger.info("Temporal worker stopped")


def main() -> None:
    maybe_start_prometheus_http_server(component="drovi-temporal-worker")
    asyncio.run(_run())


if __name__ == "__main__":
    main()
