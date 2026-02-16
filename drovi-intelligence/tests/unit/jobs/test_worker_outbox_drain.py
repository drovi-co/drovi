from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.db.rls import get_rls_context, is_rls_internal
from src.jobs.outbox import ClaimedOutboxEvent
from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_run_outbox_drain_sets_internal_rls_context(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_1",
        organization_id="internal",
        job_type="indexes.outbox.drain",
        status="running",
        priority=0,
        run_at=datetime.now(timezone.utc),
        resource_key=None,
        attempts=1,
        max_attempts=3,
        payload={"limit": 1, "lease_seconds": 30},
    )
    event = ClaimedOutboxEvent(
        id="evt_1",
        organization_id="org_test",
        event_type="indexes.derived.batch",
        priority=0,
        attempts=1,
        max_attempts=3,
        payload_version=1,
        payload={"organization_id": "org_test", "analysis_id": "a1"},
    )

    observed: dict[str, object] = {}

    async def _claim_outbox_events(*, worker_id: str, lease_seconds: int, limit: int):
        return [event]

    async def _mark_outbox_succeeded(*, event_id: str, worker_id: str) -> None:
        observed["marked_succeeded"] = (event_id, worker_id)

    async def _mark_outbox_failed(*, event_id: str, error: str, attempts: int, max_attempts: int) -> None:
        raise AssertionError(f"unexpected failure for {event_id}: {error}")

    async def _get_graph_client():
        return object()

    async def _process_outbox_event(*, graph, event_type: str, payload: dict):
        observed["context"] = (get_rls_context(), is_rls_internal())
        observed["event_type"] = event_type
        observed["payload"] = payload
        return {"ok": True}

    monkeypatch.setattr("src.jobs.outbox.claim_outbox_events", _claim_outbox_events)
    monkeypatch.setattr("src.jobs.outbox.mark_outbox_succeeded", _mark_outbox_succeeded)
    monkeypatch.setattr("src.jobs.outbox.mark_outbox_failed", _mark_outbox_failed)
    monkeypatch.setattr("src.graph.client.get_graph_client", _get_graph_client)
    monkeypatch.setattr(
        "src.contexts.uio_truth.infrastructure.derived_indexer.process_outbox_event",
        _process_outbox_event,
    )

    result = await worker._run_outbox_drain(job)

    assert result == {"processed": 1, "succeeded": 1, "failed": 0}
    assert observed["context"] == ("org_test", True)
    assert observed["event_type"] == "indexes.derived.batch"
    assert observed["payload"] == {"organization_id": "org_test", "analysis_id": "a1"}
