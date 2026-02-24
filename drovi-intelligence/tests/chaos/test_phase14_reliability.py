from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from src.jobs.queue import ClaimedJob
from src.jobs.worker import JobDispatchError, JobsWorker
from src.streaming.kafka_consumer import DroviKafkaConsumer

pytestmark = [pytest.mark.asyncio]


class _TopicPartition:
    def __init__(self, topic: str, partition: int, offset: int) -> None:
        self.topic = topic
        self.partition = partition
        self.offset = offset


class _LagMetrics:
    enabled = True

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, int, int]] = []

    def set_kafka_consumer_lag(self, group_id: str, topic: str, partition: int, lag: int) -> None:
        self.calls.append((group_id, topic, partition, lag))


class _FlakyLagConsumer:
    def __init__(self) -> None:
        self._assignment = [
            _TopicPartition(topic="raw.connector.events", partition=0, offset=10),
            _TopicPartition(topic="raw.connector.events", partition=1, offset=4),
        ]

    def assignment(self):  # noqa: ANN201
        return self._assignment

    def position(self, assignment):  # noqa: ANN001, ANN201
        return assignment

    def get_watermark_offsets(self, tp, timeout=1.0):  # noqa: ANN001, ANN201
        if tp.partition == 1:
            raise RuntimeError("partition-metadata-timeout")
        return (0, 120)


async def test_partition_lag_probe_does_not_crash_on_partial_partition_failure() -> None:
    consumer = DroviKafkaConsumer(
        bootstrap_servers="localhost:9092",
        group_id="drovi-chaos-phase14",
        topics=["raw.connector.events"],
    )
    consumer._consumer = _FlakyLagConsumer()
    metrics = _LagMetrics()
    consumer._metrics = metrics

    await consumer._report_consumer_lag()

    assert len(metrics.calls) == 0 or len(metrics.calls) == 1


async def test_worker_failure_path_recovers_without_crashing_dispatch_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = JobsWorker()
    job = ClaimedJob(
        id="job_chaos_1",
        organization_id="org_test",
        job_type="connector.sync",
        status="running",
        priority=1,
        run_at=datetime.now(UTC),
        resource_key="connection:conn_chaos",
        attempts=1,
        max_attempts=3,
        payload={},
    )

    async def _dispatch(_job: ClaimedJob):  # noqa: ANN001
        raise JobDispatchError("simulated_transient_failure", retryable=True)

    async def _heartbeat(_job_id: str) -> None:  # noqa: ANN001
        return None

    mark_failed = AsyncMock(return_value=None)
    monkeypatch.setattr(worker, "_dispatch", _dispatch)
    monkeypatch.setattr(worker, "_lease_heartbeat", _heartbeat)
    monkeypatch.setattr("src.jobs.worker.mark_job_failed", mark_failed)

    await worker._execute_claimed_job(job)

    assert mark_failed.await_count == 1
    assert mark_failed.await_args.kwargs["job_id"] == "job_chaos_1"
