import json
import time

import pytest

from src.streaming.kafka_consumer import DroviKafkaConsumer


class FakeProducer:
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


class FakeConsumerClient:
    def __init__(self) -> None:
        self.commits: list[dict] = []

    def commit(self, *, offsets=None, asynchronous: bool = False, message=None):  # type: ignore[no-untyped-def]
        # We only use explicit offset commits in the consumer implementation.
        self.commits.append(
            {
                "offsets": offsets,
                "asynchronous": asynchronous,
                "message": message,
            }
        )


class FakeMsg:
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


@pytest.mark.asyncio
async def test_handler_failure_routes_to_retry_and_commits(monkeypatch):
    fake_producer = FakeProducer()
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
        worker_concurrency=1,
    )
    consumer._consumer = FakeConsumerClient()

    async def failing_handler(_message):
        raise RuntimeError("boom")

    consumer.register_handler("topic-a", failing_handler)

    msg = FakeMsg(
        topic="topic-a",
        partition=0,
        offset=10,
        key="k1",
        value={
            "message_id": "m1",
            "timestamp": "t1",
            "payload": {"hello": "world"},
        },
        headers={"organization_id": "org-1"},
    )

    await consumer._process_message(msg)

    assert fake_producer.calls
    assert fake_producer.calls[0]["topic"] == "topic-a.retry"
    assert fake_producer.calls[0]["value"] == {"hello": "world"}
    assert fake_producer.calls[0]["headers"]["drovi_retry_count"] == "1"

    # Commit should be called (explicit offsets commit).
    assert consumer._consumer.commits  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_retry_exhaustion_routes_to_dlq(monkeypatch):
    fake_producer = FakeProducer()
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
        worker_concurrency=1,
    )
    consumer._consumer = FakeConsumerClient()

    async def failing_handler(_message):
        raise RuntimeError("boom")

    consumer.register_handler("topic-a", failing_handler)

    msg = FakeMsg(
        topic="topic-a.retry",
        partition=0,
        offset=0,
        key="k1",
        value={
            "message_id": "m1",
            "timestamp": "t1",
            "payload": {"hello": "world"},
        },
        headers={"drovi_retry_count": "999"},
    )

    await consumer._process_message(msg)

    assert fake_producer.calls
    assert fake_producer.calls[0]["topic"] == "topic-a.dlq"
    assert fake_producer.calls[0]["value"]["payload"] == {"hello": "world"}
