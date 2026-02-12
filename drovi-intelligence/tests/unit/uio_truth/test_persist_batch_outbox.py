from __future__ import annotations

import pytest
from unittest.mock import AsyncMock

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_persist_extraction_batch_enqueues_derived_index_outbox_event(monkeypatch):
    from src.contexts.uio_truth.application import persist_batch as pb

    # Make all persistence steps no-op except one that records a created UIO.
    monkeypatch.setattr(pb, "persist_contacts", AsyncMock())
    monkeypatch.setattr(pb, "persist_decisions", AsyncMock())
    monkeypatch.setattr(pb, "persist_risks", AsyncMock())
    monkeypatch.setattr(pb, "persist_tasks", AsyncMock())
    monkeypatch.setattr(pb, "persist_claims", AsyncMock())
    monkeypatch.setattr(pb, "persist_brief_uio", AsyncMock())
    monkeypatch.setattr(pb, "update_conversation_with_brief", AsyncMock())
    monkeypatch.setattr(pb, "persist_contradictions", AsyncMock())

    async def fake_persist_commitments(*, results, **kwargs):
        results.uios_created.append({"id": "u1", "type": "commitment"})

    monkeypatch.setattr(pb, "persist_commitments", fake_persist_commitments)

    enqueue_mock = AsyncMock(return_value="evt_1")
    monkeypatch.setattr("src.jobs.outbox.enqueue_outbox_event", enqueue_mock)

    envelope = PersistEnvelope(
        organization_id="org_1",
        source_type="email",
        source_account_id=None,
        conversation_id="thread_1",
        source_id="thread_1",
        analysis_id="analysis_1",
        messages=[],
        input_content="hello",
    )

    results, errors = await pb.persist_extraction_batch(
        envelope=envelope,
        commitments=[],
        decisions=[],
        risks=[],
        tasks=[],
        claims=[],
        contacts=[],
        merge_candidates=[],
        candidates_persisted=True,
        pattern_confidence_boost=0.0,
        brief=None,
        classification=None,
        contradiction_pairs=None,
        sender_email=None,
        metrics=AsyncMock(),
    )

    assert errors == []
    assert results.uios_created == [{"id": "u1", "type": "commitment"}]
    assert enqueue_mock.called

    req = enqueue_mock.call_args.args[0]
    assert req.organization_id == "org_1"
    assert req.event_type == "indexes.derived.batch"
    assert req.payload.get("analysis_id") == "analysis_1"
    assert req.payload.get("uios_created") == [{"id": "u1", "type": "commitment"}]
