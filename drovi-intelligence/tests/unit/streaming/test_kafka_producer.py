from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from src.streaming.kafka_producer import DroviKafkaProducer


class _FakeKafkaProducer:
    def __init__(self) -> None:
        self.last_produce_kwargs: dict | None = None

    def produce(self, **kwargs) -> None:
        self.last_produce_kwargs = kwargs

    def poll(self, _timeout: float) -> None:
        return None


@pytest.mark.asyncio
async def test_produce_serializes_datetime_payload_for_kafka() -> None:
    producer = DroviKafkaProducer(bootstrap_servers="localhost:9092")
    fake_producer = _FakeKafkaProducer()
    producer._producer = fake_producer

    sent_at = datetime(2026, 2, 16, 8, 26, 0)
    await producer.produce(
        topic="raw.connector.events",
        value={
            "record_id": "msg_123",
            "sent_at": sent_at,
        },
        key="test-key",
    )

    assert fake_producer.last_produce_kwargs is not None
    encoded = fake_producer.last_produce_kwargs["value"]
    payload = json.loads(encoded.decode("utf-8"))
    assert payload["payload"]["sent_at"] == sent_at.isoformat()


@pytest.mark.asyncio
async def test_produce_world_brain_event_validates_contract() -> None:
    producer = DroviKafkaProducer(bootstrap_servers="localhost:9092")
    fake_producer = _FakeKafkaProducer()
    producer._producer = fake_producer

    await producer.produce_world_brain_event(
        event_type="belief.update.v1",
        topic="belief.update",
        event={
            "schema_version": "1.0",
            "organization_id": "org-1",
            "event_id": "evt-1",
            "occurred_at": datetime(2026, 2, 22, 10, 0, 0),
            "producer": "drovi-intelligence",
            "event_type": "belief.update.v1",
            "payload": {
                "belief_id": "belief-1",
                "proposition": "Rates stay high",
                "next_state": "asserted",
                "probability": 0.7,
                "supporting_observation_ids": ["obs-1"],
                "revised_at": datetime(2026, 2, 22, 10, 0, 0),
            },
        },
        key="wb-key",
    )

    assert fake_producer.last_produce_kwargs is not None
    encoded = fake_producer.last_produce_kwargs["value"]
    payload = json.loads(encoded.decode("utf-8"))
    assert payload["payload"]["payload"]["belief_id"] == "belief-1"
    headers = {
        key: value.decode("utf-8") if isinstance(value, bytes) else value
        for key, value in (fake_producer.last_produce_kwargs.get("headers") or [])
    }
    assert headers.get("drovi_idempotency_key")
    assert headers.get("event_type") == "belief.update.v1"


@pytest.mark.asyncio
async def test_produce_world_brain_event_rejects_invalid_contract_payload() -> None:
    producer = DroviKafkaProducer(bootstrap_servers="localhost:9092")

    with pytest.raises(ValidationError):
        await producer.produce_world_brain_event(
            event_type="belief.update.v1",
            topic="belief.update",
            event={
                "schema_version": "1.0",
                "organization_id": "org-1",
                "event_id": "evt-1",
                "occurred_at": datetime(2026, 2, 22, 10, 0, 0),
                "event_type": "belief.update.v1",
                "payload": {
                    "belief_id": "belief-1",
                    "proposition": "missing required fields",
                    "next_state": "asserted",
                },
            },
        )


@pytest.mark.asyncio
async def test_produce_observation_raw_event_persists_artifact_and_emits_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = DroviKafkaProducer(bootstrap_servers="localhost:9092")
    fake_producer = _FakeKafkaProducer()
    producer._producer = fake_producer

    async def _fake_persist_raw_observation_payload(**kwargs):  # noqa: ANN003
        return SimpleNamespace(
            artifact_id="obsraw-1",
            sha256="abc123",
            storage_path="/tmp/obsraw-1.json",
            byte_size=42,
        )

    monkeypatch.setattr(
        "src.ingestion.raw_capture.persist_raw_observation_payload",
        _fake_persist_raw_observation_payload,
    )

    await producer.produce_observation_raw_event(
        organization_id="org-1",
        source_type="news_api",
        observation_type="connector.record",
        source_ref="article-1",
        content={"title": "Headline", "summary": "Summary"},
        source_metadata={"source_key": "worldnewsapi"},
        ingest_run_id="run-1",
        trace_id="trace-1",
        deterministic_key="det-1",
    )

    assert fake_producer.last_produce_kwargs is not None
    encoded = fake_producer.last_produce_kwargs["value"]
    payload = json.loads(encoded.decode("utf-8"))
    event = payload["payload"]
    assert event["event_type"] == "observation.raw.v1"
    assert event["payload"]["artifact_id"] == "obsraw-1"
    assert event["payload"]["ingest_run_id"] == "run-1"
    assert event["payload"]["trace_id"] == "trace-1"


@pytest.mark.asyncio
async def test_produce_world_brain_event_enforces_schema_registry_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = DroviKafkaProducer(bootstrap_servers="localhost:9092")
    fake_producer = _FakeKafkaProducer()
    producer._producer = fake_producer

    validate_shape = MagicMock()
    fake_registry = SimpleNamespace(validate_payload_shape=validate_shape)

    monkeypatch.setattr(
        "src.streaming.kafka_producer.get_settings",
        lambda: SimpleNamespace(
            kafka_schema_registry_enforced=True,
            kafka_topic_raw_events="raw.connector.events",
            kafka_topic_normalized_records="normalized.records",
            kafka_topic_pipeline_input="intelligence.pipeline.input",
            kafka_topic_intelligence="drovi-intelligence",
            kafka_topic_graph_changes="graph.changes",
        ),
    )
    monkeypatch.setattr(
        "src.streaming.schema_registry.get_schema_registry",
        lambda: fake_registry,
    )

    await producer.produce_world_brain_event(
        event_type="belief.update.v1",
        topic="belief.update",
        event={
            "schema_version": "1.0",
            "organization_id": "org-1",
            "event_id": "evt-2",
            "occurred_at": datetime(2026, 2, 22, 10, 0, 0),
            "producer": "drovi-intelligence",
            "event_type": "belief.update.v1",
            "payload": {
                "belief_id": "belief-2",
                "proposition": "Policy drift risk",
                "next_state": "asserted",
                "probability": 0.8,
                "supporting_observation_ids": ["obs-2"],
                "revised_at": datetime(2026, 2, 22, 10, 0, 0),
            },
        },
        key="wb-key-2",
    )

    assert validate_shape.call_count == 1
