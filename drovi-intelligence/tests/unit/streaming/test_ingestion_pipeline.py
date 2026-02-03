import pytest

from src.ingestion.priority import compute_ingest_priority, parse_priority_value
from src.streaming.ingestion_pipeline import (
    NormalizedRecordEvent,
    enrich_normalized_payload,
    normalize_raw_event_payload,
)


def test_priority_parsing():
    assert parse_priority_value("high") == 2
    assert parse_priority_value("9") == 9
    assert parse_priority_value(None) is None


def test_compute_ingest_priority_rules():
    assert compute_ingest_priority(source_type="email", job_type="webhook") == 0
    assert compute_ingest_priority(source_type="email", job_type="backfill") == 8
    assert compute_ingest_priority(source_type="slack", job_type="scheduled", is_vip=True) == 1


def test_normalize_raw_event_payload_connector_record():
    payload = {
        "event_type": "connector.record",
        "organization_id": "org-1",
        "source_type": "email",
        "source_id": "msg-1",
        "payload": {
            "connector_type": "gmail",
            "connection_id": "conn-1",
            "job_type": "scheduled",
            "record": {
                "record_id": "msg-1",
                "source_type": "gmail",
                "stream_name": "messages",
                "record_type": "message",
                "data": {
                    "subject": "Q1 Planning",
                    "body_text": "Let us sync tomorrow.",
                    "sender_email": "alice@example.com",
                },
            },
        },
    }

    normalized_event = normalize_raw_event_payload(payload)
    assert normalized_event is not None
    assert normalized_event.organization_id == "org-1"
    assert normalized_event.source_type == "email"
    assert "Q1 Planning" in normalized_event.normalized["content"]
    assert normalized_event.ingest["content_hash"]
    assert normalized_event.ingest["source_fingerprint"]


@pytest.mark.asyncio
async def test_enrich_normalized_payload_vip_priority(monkeypatch):
    class FakeContact:
        def __init__(self):
            self.id = "contact-1"
            self.display_name = "VIP"
            self.primary_email = "vip@example.com"
            self.is_vip = True

    class FakeResolution:
        def __init__(self):
            self.contact = FakeContact()

    class FakeGraph:
        async def resolve_identifier(self, *args, **kwargs):
            return FakeResolution()

    async def fake_get_identity_graph():
        return FakeGraph()

    monkeypatch.setattr(
        "src.streaming.ingestion_pipeline.get_identity_graph",
        fake_get_identity_graph,
    )

    normalized_event = NormalizedRecordEvent(
        normalized_id="norm-1",
        organization_id="org-1",
        source_type="email",
        source_id="msg-1",
        event_type="connector.record",
        record={"record_id": "msg-1"},
        normalized={
            "content": "Test content",
            "metadata": {"unified": {"sender_email": "vip@example.com"}},
            "conversation_id": "thread-1",
            "user_email": None,
            "user_name": None,
            "subject": None,
        },
        ingest={"priority": 5, "job_type": "scheduled"},
        connector_type="gmail",
        connection_id="conn-1",
    )

    pipeline_event = await enrich_normalized_payload(normalized_event)
    assert pipeline_event.ingest["priority"] == 3
    assert pipeline_event.enrichment["success_rate"] == pytest.approx(1.0)
