from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import pytest

temporalio = pytest.importorskip("temporalio")
from temporalio import activity  # noqa: E402
from temporalio.client import WorkflowFailureError  # noqa: E402
from temporalio.exceptions import CancelledError  # noqa: E402
from temporalio.testing import WorkflowEnvironment  # noqa: E402
from temporalio.worker import Worker  # noqa: E402

from src.contexts.workflows.application.connector_backfill_workflow import ConnectorBackfillWorkflow
from src.contexts.workflows.application.connector_sync_workflow import ConnectorSyncWorkflow
from src.contexts.workflows.application.scheduled_sync_sweep_workflow import (
    ScheduledSyncSweepWorkflow,
)
from src.contexts.workflows.application.system_cron_workflows import IndexesOutboxDrainCronWorkflow
@pytest.mark.unit
async def test_connector_sync_workflow_enqueues_and_waits() -> None:
    enqueue_calls: list[dict[str, Any]] = []
    poll_counts: dict[str, int] = defaultdict(int)

    @activity.defn(name="jobs.enqueue")
    async def enqueue(req: dict[str, Any]) -> str:
        enqueue_calls.append(req)
        return "job_sync_1"

    @activity.defn(name="jobs.get_snapshot")
    async def get_snapshot(job_id: str) -> dict[str, Any] | None:
        poll_counts[job_id] += 1
        if poll_counts[job_id] < 2:
            return {"id": job_id, "status": "running", "result": None, "last_error": None}
        return {"id": job_id, "status": "succeeded", "result": {"ok": True}, "last_error": None}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-sync",
            workflows=[ConnectorSyncWorkflow],
            activities=[enqueue, get_snapshot],
        ):
            handle = await env.client.start_workflow(
                ConnectorSyncWorkflow.run,
                {"organization_id": "org_test", "connection_id": "conn_test"},
                id="wf-sync-1",
                task_queue="unit-sync",
            )
            result = await handle.result()

    assert result["status"] == "succeeded"
    assert result["result"] == {"ok": True}
    assert len(enqueue_calls) == 1
    assert enqueue_calls[0]["job_type"] == "connector.sync"
    assert enqueue_calls[0]["organization_id"] == "org_test"
    assert enqueue_calls[0]["resource_key"] == "connection:conn_test"


@pytest.mark.unit
async def test_connector_backfill_workflow_windows_and_continue_as_new() -> None:
    enqueue_calls: list[dict[str, Any]] = []
    poll_counts: dict[str, int] = defaultdict(int)

    @activity.defn(name="jobs.enqueue")
    async def enqueue(req: dict[str, Any]) -> str:
        enqueue_calls.append(req)
        return f"job_backfill_{len(enqueue_calls)}"

    @activity.defn(name="jobs.get_snapshot")
    async def get_snapshot(job_id: str) -> dict[str, Any] | None:
        poll_counts[job_id] += 1
        # Succeed quickly to keep test fast.
        return {"id": job_id, "status": "succeeded", "result": {}, "last_error": None}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-backfill",
            workflows=[ConnectorBackfillWorkflow],
            activities=[enqueue, get_snapshot],
        ):
            start = datetime(2026, 1, 1, tzinfo=timezone.utc)
            end = datetime(2026, 1, 4, tzinfo=timezone.utc)
            handle = await env.client.start_workflow(
                ConnectorBackfillWorkflow.run,
                {
                    "organization_id": "org_test",
                    "connection_id": "conn_test",
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "window_days": 1,
                    "throttle_seconds": 0,
                    "max_windows_per_run": 2,
                },
                id="wf-backfill-1",
                task_queue="unit-backfill",
            )
            result = await handle.result()

    assert result["windows_completed"] == 3
    assert len(enqueue_calls) == 3
    for call in enqueue_calls:
        assert call["job_type"] == "connector.sync"
        assert call["organization_id"] == "org_test"
        assert call["resource_key"] == "connection:conn_test"


@pytest.mark.unit
async def test_scheduled_sync_sweep_enqueues_all_active_connections() -> None:
    enqueue_calls: list[dict[str, Any]] = []

    @activity.defn(name="connections.list_active")
    async def list_active(_req: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {
                "connection_id": "c1",
                "organization_id": "o1",
                "connector_type": "gmail",
                "sync_frequency_minutes": 5,
            },
            {
                "connection_id": "c2",
                "organization_id": "o2",
                "connector_type": "notion",
                "sync_frequency_minutes": 0,  # should use default (15)
            },
        ]

    @activity.defn(name="jobs.enqueue")
    async def enqueue(req: dict[str, Any]) -> str:
        enqueue_calls.append(req)
        return f"job_{len(enqueue_calls)}"

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-sweep",
            workflows=[ScheduledSyncSweepWorkflow],
            activities=[list_active, enqueue],
        ):
            handle = await env.client.start_workflow(
                ScheduledSyncSweepWorkflow.run,
                {"default_interval_minutes": 5, "sweep_limit": 100},
                id="wf-sweep-1",
                task_queue="unit-sweep",
            )
            result = await handle.result()

    assert result["enqueued"] == 2
    assert len(enqueue_calls) == 2
    assert {c["payload"]["connection_id"] for c in enqueue_calls} == {"c1", "c2"}
    assert all(c["job_type"] == "connector.sync" for c in enqueue_calls)


@pytest.mark.unit
async def test_indexes_outbox_drain_cron_enqueues_job() -> None:
    enqueue_calls: list[dict[str, Any]] = []

    @activity.defn(name="jobs.enqueue")
    async def enqueue(req: dict[str, Any]) -> str:
        enqueue_calls.append(req)
        return "job_outbox_1"

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-indexes-cron",
            workflows=[IndexesOutboxDrainCronWorkflow],
            activities=[enqueue],
        ):
            handle = await env.client.start_workflow(
                IndexesOutboxDrainCronWorkflow.run,
                {"limit": 123},
                id="wf-indexes-cron-1",
                task_queue="unit-indexes-cron",
            )
            result = await handle.result()

    assert result["job_id"] == "job_outbox_1"
    assert len(enqueue_calls) == 1
    assert enqueue_calls[0]["job_type"] == "indexes.outbox.drain"
    assert enqueue_calls[0]["payload"]["limit"] == 123


@pytest.mark.unit
async def test_connector_sync_workflow_can_be_cancelled() -> None:
    @activity.defn(name="jobs.enqueue")
    async def enqueue(_req: dict[str, Any]) -> str:
        return "job_sync_cancel"

    @activity.defn(name="jobs.get_snapshot")
    async def get_snapshot(job_id: str) -> dict[str, Any] | None:
        # Never reaches terminal state; cancellation should interrupt the wait loop.
        return {"id": job_id, "status": "running", "result": None, "last_error": None}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-cancel",
            workflows=[ConnectorSyncWorkflow],
            activities=[enqueue, get_snapshot],
        ):
            handle = await env.client.start_workflow(
                ConnectorSyncWorkflow.run,
                {"organization_id": "org_test", "connection_id": "conn_test"},
                id="wf-sync-cancel-1",
                task_queue="unit-cancel",
            )
            await handle.cancel()
            with pytest.raises((CancelledError, WorkflowFailureError)):
                await handle.result()
