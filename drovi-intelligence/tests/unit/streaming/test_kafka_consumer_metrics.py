import pytest

from src.streaming.kafka_consumer import DroviKafkaConsumer


class FakeTopicPartition:
    def __init__(self, topic: str, partition: int, offset: int = -1):
        self.topic = topic
        self.partition = partition
        self.offset = offset


class FakeMetrics:
    enabled = True

    def __init__(self) -> None:
        self.lag_calls: list[tuple[str, str, int, float]] = []

    def set_kafka_consumer_lag(
        self,
        group_id: str,
        topic: str,
        partition: int,
        lag: float,
    ) -> None:
        self.lag_calls.append((group_id, topic, partition, lag))


class FakeConsumer:
    def assignment(self):
        return [FakeTopicPartition("topic-a", 0)]

    def position(self, assignment):
        return [FakeTopicPartition(tp.topic, tp.partition, offset=10) for tp in assignment]

    def get_watermark_offsets(self, tp, timeout=1.0):
        return (0, 110)


@pytest.mark.asyncio
async def test_report_consumer_lag_sets_metrics(monkeypatch):
    fake_metrics = FakeMetrics()
    monkeypatch.setattr("src.streaming.kafka_consumer.get_metrics", lambda: fake_metrics)

    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-test",
        topics=["topic-a"],
    )
    consumer._consumer = FakeConsumer()

    await consumer._report_consumer_lag()

    assert fake_metrics.lag_calls == [("drovi-test", "topic-a", 0, 100)]
