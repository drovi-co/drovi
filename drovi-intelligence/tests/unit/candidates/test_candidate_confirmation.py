import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from src.candidates.processor import process_signal_candidate_by_id


class FakeResult:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class FakeSessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return None


@pytest.mark.asyncio
async def test_process_signal_candidate_by_id(monkeypatch):
    row = SimpleNamespace(
        id="cand-1",
        organization_id="org-1",
        candidate_type="decision",
        title="Use Stripe",
        content="We will use Stripe.",
        evidence_text="Use Stripe",
        confidence=0.8,
        conversation_id="session-1",
        source_type="meeting",
        source_id="session-1",
        source_message_id="msg-1",
        raw_payload={},
        created_at=None,
        status="pending_confirmation",
        uio_id=None,
    )

    def mapping():
        return {
            "id": row.id,
            "organization_id": row.organization_id,
            "candidate_type": row.candidate_type,
            "title": row.title,
            "content": row.content,
            "evidence_text": row.evidence_text,
            "confidence": row.confidence,
            "conversation_id": row.conversation_id,
            "source_type": row.source_type,
            "source_id": row.source_id,
            "source_message_id": row.source_message_id,
            "raw_payload": row.raw_payload,
            "created_at": row.created_at,
            "status": row.status,
            "uio_id": row.uio_id,
        }

    row._mapping = mapping()

    session_first = AsyncMock()
    session_first.execute = AsyncMock(side_effect=[FakeResult(row), FakeResult()])

    session_second = AsyncMock()
    session_second.execute = AsyncMock(return_value=FakeResult())

    calls = {"count": 0}

    def fake_get_db_session():
        calls["count"] += 1
        return FakeSessionContext(session_first if calls["count"] == 1 else session_second)

    async def fake_create_uio(_candidate):
        return "uio-123"

    monkeypatch.setattr("src.candidates.processor.get_db_session", fake_get_db_session)
    monkeypatch.setattr("src.candidates.processor._create_uio_from_candidate", fake_create_uio)

    result = await process_signal_candidate_by_id(
        candidate_id="cand-1",
        organization_id="org-1",
        confirmed_by="user-1",
    )

    assert result["status"] == "processed"
    assert result["uio_id"] == "uio-123"
