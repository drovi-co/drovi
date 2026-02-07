import asyncio
import json
import os
import time
from uuid import uuid4

import pytest

from src.streaming.kafka_consumer import DroviKafkaConsumer


pytestmark = pytest.mark.integration


def _should_run() -> bool:
    return os.getenv("DROVI_KAFKA_INTEGRATION", "").strip() == "1"


if not _should_run():  # pragma: no cover
    pytest.skip(
        "Set DROVI_KAFKA_INTEGRATION=1 to run Kafka integration tests",
        allow_module_level=True,
    )


def _utc_iso() -> str:
    # Avoid datetime imports to keep this test minimal and robust.
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _create_topics(bootstrap: str, topics: list[str]) -> None:
    from confluent_kafka.admin import AdminClient, NewTopic

    admin = AdminClient({"bootstrap.servers": bootstrap})
    new_topics = [NewTopic(t, num_partitions=1, replication_factor=1) for t in topics]
    futures = admin.create_topics(new_topics, request_timeout=10)
    for topic, fut in futures.items():
        try:
            fut.result(timeout=10)
        except Exception:
            # Topic might already exist; ok for local dev.
            pass


def _produce_json(bootstrap: str, topic: str, messages: list[dict]) -> None:
    from confluent_kafka import Producer

    producer = Producer({"bootstrap.servers": bootstrap})
    for msg in messages:
        producer.produce(topic, json.dumps(msg).encode("utf-8"))
    producer.flush(10)


def _poll_one(bootstrap: str, topic: str, *, timeout_s: float = 10.0) -> dict | None:
    from confluent_kafka import Consumer

    consumer = Consumer(
        {
            "bootstrap.servers": bootstrap,
            "group.id": f"drovi-test:{uuid4()}",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
        }
    )
    consumer.subscribe([topic])
    try:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                continue
            raw = json.loads((msg.value() or b"{}").decode("utf-8"))
            return raw
        return None
    finally:
        consumer.close()


@pytest.mark.asyncio
async def test_poison_message_routes_and_does_not_wedge_consumer(monkeypatch):
    bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092")
    monkeypatch.setenv("KAFKA_BOOTSTRAP_SERVERS", bootstrap)

    base_topic = f"test.poison.{uuid4().hex[:10]}"
    retry_topic = f"{base_topic}.retry"
    dlq_topic = f"{base_topic}.dlq"
    _create_topics(bootstrap, [base_topic, retry_topic, dlq_topic])

    # 1) Produce poison then good. Wrapper matches DroviKafkaProducer envelope.
    poison = {
        "message_id": "m1",
        "timestamp": _utc_iso(),
        "payload": {"kind": "poison"},
    }
    good = {
        "message_id": "m2",
        "timestamp": _utc_iso(),
        "payload": {"kind": "good"},
    }
    _produce_json(bootstrap, base_topic, [poison, good])

    processed_good = asyncio.Event()

    consumer = DroviKafkaConsumer(
        bootstrap_servers=bootstrap,
        group_id=f"drovi-it:{uuid4()}",
        topics=[base_topic],
        enable_auto_commit=False,
        worker_concurrency=1,
        queue_maxsize=100,
    )
    await consumer.connect()

    async def handler(message: dict) -> None:
        payload = message.get("payload") or {}
        if payload.get("kind") == "poison":
            raise RuntimeError("boom")
        processed_good.set()

    consumer.register_handler(base_topic, handler)

    task = asyncio.create_task(consumer.start())
    try:
        await asyncio.wait_for(processed_good.wait(), timeout=15.0)
    finally:
        await consumer.stop()
        await consumer.close()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    # 2) Verify poison was routed to retry topic (not wedging the base partition).
    routed = _poll_one(bootstrap, retry_topic, timeout_s=10.0)
    assert routed is not None
    assert routed.get("payload") == {"kind": "poison"}

    # 3) Should not immediately DLQ on first failure.
    dlq_msg = _poll_one(bootstrap, dlq_topic, timeout_s=2.0)
    assert dlq_msg is None

