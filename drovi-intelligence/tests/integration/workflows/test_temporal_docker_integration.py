from __future__ import annotations

import os
from datetime import timedelta
from uuid import uuid4

import pytest

temporalio = pytest.importorskip("temporalio")
from temporalio.client import Client  # noqa: E402

from src.contexts.workflows.application.diagnostics_workflow import DiagnosticsNoopWorkflow


@pytest.mark.integration
async def test_temporal_worker_wiring_smoke() -> None:
    """
    Minimal docker integration test.

    This validates the full chain:
    test -> Temporal server -> drovi-temporal-worker -> jobs.enqueue activity ->
    Postgres durable job -> drovi-jobs-worker -> jobs.get_snapshot polling.

    Opt-in to avoid flakiness in environments without the compose stack:
    - TEMPORAL_INTEGRATION=1
    """
    if os.getenv("TEMPORAL_INTEGRATION") != "1":
        pytest.skip("Set TEMPORAL_INTEGRATION=1 to run Temporal docker integration tests")

    address = os.getenv("TEMPORAL_ADDRESS") or "temporal:7233"
    namespace = os.getenv("TEMPORAL_NAMESPACE") or "default"
    task_queue = os.getenv("TEMPORAL_TASK_QUEUE") or "drovi-workflows"

    client = await Client.connect(address, namespace=namespace)
    try:
        handle = await client.start_workflow(
            DiagnosticsNoopWorkflow.run,
            {"organization_id": "internal"},
            id=f"itest-noop-{uuid4()}",
            task_queue=task_queue,
            execution_timeout=timedelta(minutes=5),
        )
        result = await handle.result()
        assert result["status"] == "succeeded"
    finally:
        await client.close()
