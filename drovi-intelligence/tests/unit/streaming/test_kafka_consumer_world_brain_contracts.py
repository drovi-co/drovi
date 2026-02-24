from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from src.streaming.kafka_consumer import DroviKafkaConsumer


class _FakeProducer:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def produce(self, *, topic: str, value: dict, key: str | None = None, headers=None, wait_for_delivery: bool = False):  # type: ignore[override]
        self.calls.append(
            {
                "topic": topic,
                "value": value,
                "key": key,
                "headers": headers or {},
            }
        )
        return "msg-id"


class _FakeConsumerClient:
    def __init__(self) -> None:
        self.commits: list[dict] = []

    def commit(self, *, offsets=None, asynchronous: bool = False, message=None):  # type: ignore[no-untyped-def]
        self.commits.append(
            {
                "offsets": offsets,
                "asynchronous": asynchronous,
                "message": message,
            }
        )


class _FakeMsg:
    def __init__(
        self,
        *,
        topic: str,
        partition: int,
        offset: int,
        key: str | None,
        value: dict,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._topic = topic
        self._partition = partition
        self._offset = offset
        self._key = key
        self._value = json.dumps(value).encode("utf-8")
        self._headers = headers or {}

    def topic(self) -> str:
        return self._topic

    def partition(self) -> int:
        return self._partition

    def offset(self) -> int:
        return self._offset

    def key(self):
        return self._key.encode("utf-8") if self._key is not None else None

    def value(self) -> bytes:
        return self._value

    def headers(self):
        return [(k, v.encode("utf-8")) for k, v in self._headers.items()]

    def timestamp(self):
        return (0, int(time.time() * 1000))


def _valid_world_brain_event() -> dict:
    return {
        "schema_version": "1.0",
        "organization_id": "org-1",
        "event_id": "evt-1",
        "occurred_at": datetime(2026, 2, 22, 10, 0, 0, tzinfo=timezone.utc).isoformat(),
        "producer": "drovi-intelligence",
        "event_type": "belief.update.v1",
        "payload": {
            "belief_id": "belief-1",
            "proposition": "Rates stay high",
            "next_state": "asserted",
            "probability": 0.7,
            "supporting_observation_ids": ["obs-1"],
            "revised_at": datetime(2026, 2, 22, 10, 0, 0, tzinfo=timezone.utc).isoformat(),
        },
    }


def test_validate_world_brain_payload_accepts_valid_event() -> None:
    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
    )
    validated = consumer._validate_world_brain_payload(_valid_world_brain_event())

    assert validated["event_type"] == "belief.update.v1"
    assert validated["payload"]["belief_id"] == "belief-1"


def test_validate_world_brain_payload_ignores_non_contract_payload() -> None:
    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
    )
    payload = {"hello": "world"}

    validated = consumer._validate_world_brain_payload(payload)
    assert validated == payload


def test_validate_world_brain_payload_rejects_invalid_event() -> None:
    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
    )
    invalid = _valid_world_brain_event()
    invalid["payload"] = {
        "belief_id": "belief-1",
        "proposition": "missing required fields",
        "next_state": "asserted",
    }

    with pytest.raises(ValidationError):
        consumer._validate_world_brain_payload(invalid)


@pytest.mark.asyncio
async def test_invalid_world_brain_payload_is_routed_to_retry(monkeypatch):
    fake_producer = _FakeProducer()

    async def _fake_get_kafka_producer():
        return fake_producer

    monkeypatch.setattr(
        "src.streaming.kafka_producer.get_kafka_producer",
        _fake_get_kafka_producer,
    )

    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
        enable_auto_commit=False,
    )
    consumer._consumer = _FakeConsumerClient()

    async def pass_handler(_message):
        return None

    consumer.register_handler("topic-a", pass_handler)

    invalid = _valid_world_brain_event()
    invalid["payload"] = {
        "belief_id": "belief-1",
        "proposition": "missing required fields",
        "next_state": "asserted",
    }

    msg = _FakeMsg(
        topic="topic-a",
        partition=0,
        offset=5,
        key="k1",
        value={
            "message_id": "m1",
            "timestamp": "t1",
            "payload": invalid,
        },
    )

    await consumer._process_message(msg)

    assert fake_producer.calls
    assert fake_producer.calls[0]["topic"] == "topic-a.retry"


@pytest.mark.asyncio
async def test_idempotency_key_skips_duplicate_processing() -> None:
    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
        enable_auto_commit=False,
    )
    consumer._consumer = _FakeConsumerClient()

    handled: list[dict] = []

    async def pass_handler(message):
        handled.append(message)

    consumer.register_handler("topic-a", pass_handler)

    msg1 = _FakeMsg(
        topic="topic-a",
        partition=0,
        offset=5,
        key="k1",
        headers={"drovi_idempotency_key": "idem-1"},
        value={
            "message_id": "m1",
            "timestamp": "t1",
            "payload": _valid_world_brain_event(),
        },
    )
    msg2 = _FakeMsg(
        topic="topic-a",
        partition=0,
        offset=6,
        key="k2",
        headers={"drovi_idempotency_key": "idem-1"},
        value={
            "message_id": "m2",
            "timestamp": "t2",
            "payload": _valid_world_brain_event(),
        },
    )

    await consumer._process_message(msg1)
    await consumer._process_message(msg2)

    assert len(handled) == 1
