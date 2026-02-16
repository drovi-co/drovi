from datetime import datetime, timezone
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest

from src.documents.jobs import process_document_job
from src.graphrag.query import DroviGraphRAG
from src.orchestrator.nodes.extract_commitments import extract_commitments_node
from src.orchestrator.state import AnalysisInput, IntelligenceState, ParsedMessage
from src.streaming.kafka_consumer import DroviKafkaConsumer


@pytest.mark.asyncio
async def test_llm_failure_does_not_crash_extraction(monkeypatch):
    message = ParsedMessage(
        id="msg-1",
        content="I'll send the updated pricing sheet tomorrow.",
        sender_email="taylor@example.com",
        sender_name="Taylor",
        sent_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        is_from_user=False,
    )

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org-1",
            content=message.content,
            source_type="email",
            source_id="thread-1",
            conversation_id="thread-1",
        ),
        messages=[message],
    )

    class BrokenLLM:
        async def complete_structured(self, *args, **kwargs):
            raise RuntimeError("LLM unavailable")

    async def fake_get_org_profile(*args, **kwargs):
        return None

    monkeypatch.setattr(
        "src.orchestrator.nodes.extract_commitments.get_llm_service",
        lambda: BrokenLLM(),
    )
    monkeypatch.setattr(
        "src.orchestrator.nodes.extract_commitments.get_org_profile",
        fake_get_org_profile,
    )

    result = await extract_commitments_node(state)
    assert "trace" in result
    assert any("extract_commitments" in err for err in result["trace"]["errors"])


@pytest.mark.asyncio
async def test_kafka_lag_reporting_failure_is_handled(monkeypatch):
    class FakeMetrics:
        enabled = True

        def set_kafka_consumer_lag(self, *args, **kwargs):
            return None

    class BrokenConsumer:
        def assignment(self):
            raise RuntimeError("Kafka broker unavailable")

    monkeypatch.setattr("src.streaming.kafka_consumer.get_metrics", lambda: FakeMetrics())

    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-chaos",
        topics=["raw.connector.events"],
    )
    consumer._consumer = BrokenConsumer()

    # Should not raise
    await consumer._report_consumer_lag()


@pytest.mark.asyncio
async def test_falkor_outage_graphrag_returns_safe_refusal(monkeypatch):
    graphrag = DroviGraphRAG()

    monkeypatch.setattr(
        graphrag,
        "_classify_intent_keywords",
        lambda _question: {
            "primary_intent": "commitments",
            "secondary_intents": [],
            "entity_name": None,
            "topic_filter": None,
            "is_cross_entity": False,
        },
    )
    monkeypatch.setattr(graphrag, "_execute_graph_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(graphrag, "_fallback_chain", AsyncMock(return_value=[]))
    monkeypatch.setattr(graphrag, "_closest_matches_fallback", AsyncMock(return_value=[]))
    monkeypatch.setattr(graphrag, "_extract_sources", lambda _rows: [])
    monkeypatch.setattr(graphrag, "_template_synthesize", lambda **_kwargs: "empty response")

    result = await graphrag.query(
        question="What commitments are open?",
        organization_id="org_test",
        include_evidence=True,
        llm_enabled=False,
        visibility_is_admin=True,
    )

    assert "without evidence" in result["answer"].lower()


@pytest.mark.asyncio
async def test_object_store_outage_marks_document_failed(monkeypatch):
    doc_row = SimpleNamespace(
        id="doc_1",
        organization_id="org_test",
        title="Doc",
        file_name="contract.pdf",
        mime_type="application/pdf",
        byte_size=100,
        sha256="a" * 64,
        storage_path="org_test/contract.pdf",
        folder_path="/",
        status="uploaded",
    )

    session = AsyncMock()
    result = MagicMock()
    result.fetchone.return_value = doc_row
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()

    @asynccontextmanager
    async def fake_session():
        yield session

    mark_failed = AsyncMock(return_value=None)

    monkeypatch.setattr("src.documents.jobs.get_db_session", fake_session)
    monkeypatch.setattr("src.documents.jobs.get_object_bytes", AsyncMock(side_effect=RuntimeError("minio_down")))
    monkeypatch.setattr("src.documents.jobs._mark_document_failed", mark_failed)
    monkeypatch.setattr("src.documents.jobs.emit_document_failed", AsyncMock(return_value=None))
    monkeypatch.setattr("src.documents.jobs.emit_document_processing", AsyncMock(return_value=None))

    with pytest.raises(RuntimeError, match="minio_down"):
        await process_document_job(organization_id="org_test", document_id="doc_1")

    mark_failed.assert_awaited_once()
