import pytest

from src.streaming.ingestion_pipeline import (
    normalize_raw_event_payload,
    enrich_normalized_payload,
)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_connector_event_normalizes_and_enriches(monkeypatch):
    payload = {
        "event_type": "connector.record",
        "organization_id": "org-123",
        "source_type": "email",
        "source_id": "msg-9",
        "payload": {
            "connector_type": "gmail",
            "connection_id": "conn-1",
            "job_type": "scheduled",
            "record": {
                "record_id": "msg-9",
                "source_type": "gmail",
                "stream_name": "messages",
                "record_type": "message",
                "data": {
                    "subject": "Q2 Launch Plan",
                    "body_text": "We decided to move to AWS. I'll send the summary by Friday.",
                    "sender_email": "alex@example.com",
                },
            },
        },
    }

    normalized_event = normalize_raw_event_payload(payload)
    assert normalized_event is not None
    assert normalized_event.organization_id == "org-123"
    assert normalized_event.source_type == "email"
    assert "Q2 Launch Plan" in normalized_event.normalized["content"]
    assert normalized_event.ingest["content_hash"]
    assert normalized_event.ingest["source_fingerprint"]

    class FakeGraph:
        async def resolve_identifier(self, *args, **kwargs):
            return None

    async def fake_get_identity_graph():
        return FakeGraph()

    monkeypatch.setattr(
        "src.streaming.ingestion_pipeline.get_identity_graph",
        fake_get_identity_graph,
    )

    pipeline_event = await enrich_normalized_payload(normalized_event)
    assert pipeline_event.organization_id == "org-123"
    assert "AWS" in pipeline_event.content
    assert pipeline_event.ingest["priority"] is not None
    assert pipeline_event.ingest["content_hash"] == normalized_event.ingest["content_hash"]
