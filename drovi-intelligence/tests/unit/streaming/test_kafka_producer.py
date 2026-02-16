from __future__ import annotations

import json
from datetime import datetime

import pytest

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

