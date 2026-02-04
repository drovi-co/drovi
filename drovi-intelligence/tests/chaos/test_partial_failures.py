from datetime import datetime, timezone

import pytest

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
