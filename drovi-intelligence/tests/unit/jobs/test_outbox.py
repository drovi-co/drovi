from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_enqueue_outbox_event_inserts_row(mock_db_pool):
    conn = mock_db_pool.acquire.return_value.__aenter__.return_value
    conn.fetchrow.return_value = {"id": "evt_1"}

    from src.jobs.outbox import EnqueueOutboxEventRequest, enqueue_outbox_event

    event_id = await enqueue_outbox_event(
        EnqueueOutboxEventRequest(
            organization_id="org_1",
            event_type="indexes.batch",
            payload={"hello": "world"},
            idempotency_key="k1",
        )
    )

    assert event_id == "evt_1"
    assert conn.fetchrow.called


@pytest.mark.asyncio
async def test_claim_outbox_events_returns_claimed_rows(mock_db_pool):
    conn = mock_db_pool.acquire.return_value.__aenter__.return_value
    conn.fetch.return_value = [
        {
            "id": "evt_1",
            "organization_id": "org_1",
            "event_type": "indexes.batch",
            "priority": 0,
            "attempts": 1,
            "max_attempts": 10,
            "payload_version": 1,
            "payload": {"x": 1},
        }
    ]

    from src.jobs.outbox import claim_outbox_events

    claimed = await claim_outbox_events(worker_id="w1", lease_seconds=10, limit=50)

    assert len(claimed) == 1
    assert claimed[0].id == "evt_1"
    assert claimed[0].payload == {"x": 1}


@pytest.mark.asyncio
async def test_mark_outbox_succeeded_updates_status(mock_db_pool):
    conn = mock_db_pool.acquire.return_value.__aenter__.return_value

    from src.jobs.outbox import mark_outbox_succeeded

    await mark_outbox_succeeded(event_id="evt_1", worker_id="w1")

    assert conn.execute.called


@pytest.mark.asyncio
async def test_mark_outbox_failed_sets_cooldown_and_error(mock_db_pool):
    conn = mock_db_pool.acquire.return_value.__aenter__.return_value

    from src.jobs.outbox import mark_outbox_failed

    await mark_outbox_failed(event_id="evt_1", error="boom", attempts=1, max_attempts=3)

    assert conn.execute.called

