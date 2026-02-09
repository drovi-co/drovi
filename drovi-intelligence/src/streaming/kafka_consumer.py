"""
Kafka Consumer

Consumes events from Kafka topics for real-time processing.
Supports consumer groups, offset management, and graceful shutdown.

Processes:
- Raw connector events → Normalization
- Normalized records → Enrichment
- Pipeline input → Intelligence extraction
- Graph changes → SSE broadcast
"""

import asyncio
import base64
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog

from src.config import get_settings
from src.ingestion.priority import parse_priority_value
from src.monitoring.metrics import get_metrics

logger = structlog.get_logger()

# Global consumer instance
_kafka_consumer: "DroviKafkaConsumer | None" = None


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class _PartitionOffsetTracker:
    """
    Tracks offsets for a single (topic, partition) to allow safe commits when
    messages are processed out-of-order (due to worker concurrency/priority).
    """

    last_committed_offset: int
    processed_offsets: set[int] = field(default_factory=set)

    def mark_processed(self, offset: int) -> int | None:
        """
        Mark an offset as processed and return the next commit offset if the
        contiguous processed window advanced, otherwise None.

        Kafka commits represent "next offset to consume", so we commit
        `last_committed_offset + 1` once all offsets up to that point are done.
        """
        if offset <= self.last_committed_offset:
            return None

        self.processed_offsets.add(offset)

        advanced = False
        while (self.last_committed_offset + 1) in self.processed_offsets:
            self.processed_offsets.remove(self.last_committed_offset + 1)
            self.last_committed_offset += 1
            advanced = True

        if not advanced:
            return None

        return self.last_committed_offset + 1


class DroviKafkaConsumer:
    """
    Kafka consumer for the Drovi Intelligence Platform.

    Features:
    - Async message consumption
    - Consumer group coordination
    - Manual offset commits for reliability
    - Graceful shutdown handling
    - Message handlers with error isolation
    """

    def __init__(
        self,
        bootstrap_servers: str,
        group_id: str,
        topics: list[str],
        security_protocol: str = "PLAINTEXT",
        sasl_mechanism: str | None = None,
        sasl_username: str | None = None,
        sasl_password: str | None = None,
        auto_offset_reset: str = "earliest",
        enable_auto_commit: bool = False,
        worker_concurrency: int = 4,
        queue_maxsize: int = 1000,
        topic_priorities: dict[str, int] | None = None,
        lag_report_interval_seconds: int = 30,
    ):
        """Initialize Kafka consumer."""
        self.bootstrap_servers = bootstrap_servers
        self.group_id = group_id
        self.topics = topics
        self.security_protocol = security_protocol
        self.sasl_mechanism = sasl_mechanism
        self.sasl_username = sasl_username
        self.sasl_password = sasl_password
        self.auto_offset_reset = auto_offset_reset
        self.enable_auto_commit = enable_auto_commit
        self.worker_concurrency = max(1, worker_concurrency)
        self.queue_maxsize = max(100, queue_maxsize)
        self.topic_priorities = topic_priorities or {}
        self._consumer = None
        self._running = False
        self._handlers: dict[str, Callable] = {}
        self._default_handler: Callable | None = None
        self._queue: asyncio.PriorityQueue | None = None
        self._workers: list[asyncio.Task] = []
        self._counter = 0
        self._paused = False
        self._metrics = get_metrics()
        self._lag_report_interval_seconds = max(5, lag_report_interval_seconds)
        self._last_lag_report = 0.0
        settings = get_settings()
        self._retry_suffix = settings.kafka_retry_suffix
        self._dlq_suffix = settings.kafka_dlq_suffix
        self._max_retry_attempts = max(0, settings.kafka_max_retry_attempts)
        self._max_retry_attempts_by_topic = settings.kafka_max_retry_attempts_by_topic or {}
        self._partition_offsets: dict[tuple[str, int], _PartitionOffsetTracker] = {}

    async def connect(self) -> None:
        """Initialize the Kafka consumer connection."""
        try:
            from confluent_kafka import Consumer

            config = {
                "bootstrap.servers": self.bootstrap_servers,
                "group.id": self.group_id,
                "security.protocol": self.security_protocol,
                "auto.offset.reset": self.auto_offset_reset,
                "enable.auto.commit": self.enable_auto_commit,
                "max.poll.interval.ms": 300000,
                "session.timeout.ms": 30000,
                "heartbeat.interval.ms": 10000,
            }

            # SASL authentication (required for Upstash Kafka)
            if self.sasl_mechanism:
                config["sasl.mechanism"] = self.sasl_mechanism
                if self.sasl_username:
                    config["sasl.username"] = self.sasl_username
                if self.sasl_password:
                    config["sasl.password"] = self.sasl_password

            # For SASL_SSL (Upstash), librdkafka uses system CA store
            if self.security_protocol == "SASL_SSL":
                pass

            self._consumer = Consumer(config)
            # Assignment callbacks are passed to `subscribe`, not as config keys.
            self._consumer.subscribe(
                self.topics,
                on_assign=self._on_assign,
                on_revoke=self._on_revoke,
            )

            logger.info(
                "Kafka consumer connected",
                bootstrap_servers=self.bootstrap_servers,
                group_id=self.group_id,
                topics=self.topics,
            )
        except ImportError:
            logger.warning(
                "confluent-kafka not installed, consumer running in mock mode"
            )
            self._consumer = None
        except Exception as e:
            logger.error("Failed to connect Kafka consumer", error=str(e))
            raise

    async def close(self) -> None:
        """Close the consumer gracefully."""
        self._running = False

        if self._consumer:
            self._consumer.close()
            self._consumer = None
            logger.info("Kafka consumer closed")

    def register_handler(
        self,
        topic: str,
        handler: Callable[[dict[str, Any]], Any],
    ) -> None:
        """
        Register a message handler for a specific topic.

        Args:
            topic: Topic to handle
            handler: Async function to process messages
        """
        self._handlers[topic] = handler
        logger.info("Registered handler for topic", topic=topic)

    def set_default_handler(
        self,
        handler: Callable[[str, dict[str, Any]], Any],
    ) -> None:
        """
        Set a default handler for topics without specific handlers.

        Args:
            handler: Async function that takes (topic, message)
        """
        self._default_handler = handler
        logger.info("Set default message handler")

    async def start(self) -> None:
        """
        Start consuming messages.

        This runs in a loop until stop() is called.
        """
        if not self._consumer:
            logger.warning("Consumer not connected, skipping start")
            return

        self._running = True
        logger.info("Starting Kafka consumer loop")
        self._queue = asyncio.PriorityQueue(maxsize=self.queue_maxsize)
        self._workers = [
            asyncio.create_task(self._worker_loop(index))
            for index in range(self.worker_concurrency)
        ]

        try:
            while self._running:
                # Poll for messages
                # confluent-kafka poll is blocking; offload to a thread to keep the loop responsive
                msg = await asyncio.to_thread(self._consumer.poll, timeout=1.0)
                poll_ts = time.time()
                self._metrics.set_kafka_last_poll(self.group_id, poll_ts)

                if self._queue:
                    self._metrics.set_kafka_queue_depth(self.group_id, self._queue.qsize())
                self._metrics.set_kafka_paused(self.group_id, self._paused)

                if (
                    poll_ts - self._last_lag_report
                    >= self._lag_report_interval_seconds
                ):
                    await self._report_consumer_lag()
                    self._last_lag_report = poll_ts

                if msg is None:
                    continue

                if msg.error():
                    from confluent_kafka import KafkaError

                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        # End of partition, not an error
                        continue
                    logger.error("Consumer error", error=msg.error())
                    continue

                # Backpressure: pause when queue is saturated
                if self._queue and self._queue.qsize() >= int(self.queue_maxsize * 0.8):
                    if not self._paused:
                        assignment = self._consumer.assignment()
                        if assignment:
                            self._consumer.pause(assignment)
                            self._paused = True
                            self._metrics.set_kafka_paused(self.group_id, True)
                            logger.warning("Kafka consumer paused due to backpressure")

                if self._queue:
                    await self._enqueue_message(msg)

                # Resume when queue drains
                if self._paused and self._queue and self._queue.qsize() <= int(self.queue_maxsize * 0.4):
                    assignment = self._consumer.assignment()
                    if assignment:
                        self._consumer.resume(assignment)
                        self._paused = False
                        self._metrics.set_kafka_paused(self.group_id, False)
                        logger.info("Kafka consumer resumed")

        except Exception as e:
            logger.error("Consumer loop error", error=str(e))
            raise
        finally:
            self._running = False
            await self._stop_workers()

    async def stop(self) -> None:
        """Stop the consumer loop gracefully."""
        self._running = False
        logger.info("Stopping Kafka consumer")
        await self._stop_workers()

    async def _stop_workers(self) -> None:
        if self._workers:
            for task in self._workers:
                task.cancel()
            await asyncio.gather(*self._workers, return_exceptions=True)
            self._workers = []

    async def _enqueue_message(self, msg) -> None:
        """Place message on the priority queue."""
        if not self._queue:
            await self._process_message(msg)
            return
        topic = msg.topic()
        try:
            self._ensure_partition_tracker(topic, msg.partition(), msg.offset())
        except Exception:
            # Never fail enqueue due to bookkeeping.
            pass
        priority = self._resolve_priority(msg, topic)
        self._counter += 1
        await self._queue.put((priority, self._counter, msg))

    def _resolve_priority(self, msg, topic: str) -> int:
        """Resolve priority from headers or topic defaults (lower = higher priority)."""
        base_topic = topic
        if self._retry_suffix and topic.endswith(self._retry_suffix):
            base_topic = topic[: -len(self._retry_suffix)]
        elif self._dlq_suffix and topic.endswith(self._dlq_suffix):
            base_topic = topic[: -len(self._dlq_suffix)]

        # Retry topics should be slightly lower priority than their base topic.
        default_priority = self.topic_priorities.get(base_topic, 10)
        if base_topic != topic:
            default_priority += 1
        try:
            headers = {}
            if msg.headers():
                headers = {
                    h[0]: h[1].decode("utf-8") if h[1] else None
                    for h in msg.headers()
                }
            header_value = (
                headers.get("priority")
                or headers.get("priority_class")
                or headers.get("ingest_priority")
            )
            parsed = parse_priority_value(header_value)
            if parsed is not None:
                return parsed
        except Exception:
            return default_priority
        return default_priority

    def _on_assign(self, consumer, partitions) -> None:  # pragma: no cover
        # Reset offset trackers on rebalances to avoid committing stale offsets.
        self._partition_offsets.clear()
        try:
            consumer.assign(partitions)
        except Exception:
            pass
        logger.info("Kafka partitions assigned", count=len(partitions))

    def _on_revoke(self, consumer, partitions) -> None:  # pragma: no cover
        self._partition_offsets.clear()
        logger.info("Kafka partitions revoked", count=len(partitions))

    def _ensure_partition_tracker(self, topic: str, partition: int, offset: int) -> None:
        key = (topic, partition)
        if key in self._partition_offsets:
            return
        # We have observed `offset` as the earliest fetched offset for this partition
        # (polling is ordered per partition). Do not commit past it until processed.
        self._partition_offsets[key] = _PartitionOffsetTracker(last_committed_offset=offset - 1)

    def _base_topic(self, topic: str) -> str:
        if self._retry_suffix and topic.endswith(self._retry_suffix):
            return topic[: -len(self._retry_suffix)]
        if self._dlq_suffix and topic.endswith(self._dlq_suffix):
            return topic[: -len(self._dlq_suffix)]
        return topic

    async def _commit_if_possible(self, topic: str, partition: int, offset: int) -> None:
        """
        Commit offsets safely when processing is concurrent/out-of-order.
        """
        if self.enable_auto_commit or not self._consumer:
            return

        key = (topic, partition)
        tracker = self._partition_offsets.get(key)
        if tracker is None:
            self._ensure_partition_tracker(topic, partition, offset)
            tracker = self._partition_offsets[key]

        commit_offset = tracker.mark_processed(offset)
        if commit_offset is None:
            return

        try:
            try:
                from confluent_kafka import TopicPartition  # type: ignore

                offsets = [TopicPartition(topic, partition, commit_offset)]
            except Exception:
                # In unit tests (or minimal environments) confluent-kafka may be absent.
                # The fake consumer only needs "some" offsets payload to record commits.
                offsets = [(topic, partition, commit_offset)]

            await asyncio.to_thread(
                self._consumer.commit,
                offsets=offsets,
                asynchronous=False,
            )
        except Exception as exc:
            logger.warning(
                "Kafka commit failed",
                topic=topic,
                partition=partition,
                commit_offset=commit_offset,
                error=str(exc),
            )

    def _get_header_int(self, headers: dict[str, str | None], key: str) -> int | None:
        value = headers.get(key)
        if value is None:
            return None
        try:
            return int(value)
        except Exception:
            return None

    async def _route_failed_message(
        self,
        *,
        topic: str,
        key: str | None,
        partition: int,
        offset: int,
        headers: dict[str, str | None],
        payload: Any,
        error: Exception,
    ) -> None:
        """
        Route a failed message to a retry topic (bounded attempts) or a DLQ.

        This prevents poison messages from wedging consumer groups and provides
        an operator-friendly replay surface.
        """
        from src.streaming.kafka_producer import get_kafka_producer

        producer = await get_kafka_producer()
        base_topic = self._base_topic(topic)
        max_attempts = self._max_retry_attempts_by_topic.get(base_topic, self._max_retry_attempts)
        retry_count = self._get_header_int(headers, "drovi_retry_count") or 0

        try:
            self._metrics.inc_kafka_handler_error(
                self.group_id,
                base_topic,
                type(error).__name__,
            )
        except Exception:
            pass

        # Prefer retry first (bounded), then DLQ.
        if (
            retry_count < max_attempts
            and self._retry_suffix
            and isinstance(payload, dict)
        ):
            retry_topic = f"{base_topic}{self._retry_suffix}"
            await producer.produce(
                topic=retry_topic,
                value=payload,
                key=key,
                headers={
                    **{k: v for k, v in headers.items() if v is not None},
                    "drovi_retry_count": str(retry_count + 1),
                    "drovi_original_topic": base_topic,
                    "drovi_original_partition": str(partition),
                    "drovi_original_offset": str(offset),
                    "drovi_error": str(error),
                },
            )
            try:
                self._metrics.inc_kafka_message_routed(
                    self.group_id,
                    base_topic,
                    "retry",
                )
            except Exception:
                pass
            return

        if not self._dlq_suffix:
            # As a last resort, drop with a clear log; callers decide commit behavior.
            logger.error(
                "DLQ routing disabled; message dropped",
                topic=topic,
                partition=partition,
                offset=offset,
                error=str(error),
            )
            try:
                self._metrics.inc_kafka_message_routed(
                    self.group_id,
                    base_topic,
                    "drop",
                )
            except Exception:
                pass
            return

        dlq_topic = f"{base_topic}{self._dlq_suffix}"
        dlq_key = key or f"{base_topic}:{partition}:{offset}"

        dlq_value: dict[str, Any] = {
            "failed_at": utc_now().isoformat(),
            "base_topic": base_topic,
            "original_topic": topic,
            "original_partition": partition,
            "original_offset": offset,
            "original_key": key,
            "retry_count": retry_count,
            "error": str(error),
            "error_type": type(error).__name__,
            "headers": headers,
            "payload": payload,
        }

        await producer.produce(
            topic=dlq_topic,
            value=dlq_value,
            key=dlq_key,
            headers={
                "drovi_dlq": "1",
                "drovi_original_topic": base_topic,
                "drovi_original_partition": str(partition),
            },
        )
        try:
            self._metrics.inc_kafka_message_routed(
                self.group_id,
                base_topic,
                "dlq",
            )
        except Exception:
            pass

    async def _worker_loop(self, index: int) -> None:
        """Worker loop that processes queued messages."""
        if not self._queue:
            return
        while self._running:
            try:
                _, _, msg = await self._queue.get()
                await self._process_message(msg)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Kafka worker error", worker=index, error=str(e))
            finally:
                if self._queue:
                    self._queue.task_done()

    async def _process_message(self, msg) -> None:
        """Process a single Kafka message."""
        topic = msg.topic()
        key = msg.key().decode("utf-8") if msg.key() else None
        partition = msg.partition()
        offset = msg.offset()

        try:
            # Deserialize the message
            value = json.loads(msg.value().decode("utf-8"))

            # Extract headers
            headers = {}
            if msg.headers():
                headers = {
                    h[0]: h[1].decode("utf-8") if h[1] else None
                    for h in msg.headers()
                }

            message = {
                "topic": topic,
                "key": key,
                "partition": partition,
                "offset": offset,
                "headers": headers,
                "timestamp": msg.timestamp()[1] if msg.timestamp() else None,
                **value,
            }

            logger.debug(
                "Processing message",
                topic=topic,
                key=key,
                partition=partition,
                offset=offset,
            )

            # Find and call the handler
            handler_topic = self._base_topic(topic)

            if handler_topic in self._handlers:
                handler = self._handlers[handler_topic]
                if asyncio.iscoroutinefunction(handler):
                    await handler(message)
                else:
                    handler(message)
            elif self._default_handler:
                if asyncio.iscoroutinefunction(self._default_handler):
                    await self._default_handler(handler_topic, message)
                else:
                    self._default_handler(handler_topic, message)
            else:
                raise RuntimeError(f"No handler for topic: {handler_topic}")

            # Commit offset after successful processing
            await self._commit_if_possible(topic, partition, offset)

            logger.debug(
                "Message processed",
                topic=topic,
                key=key,
                partition=partition,
                offset=offset,
            )

        except json.JSONDecodeError as e:
            logger.error(
                "Failed to deserialize message",
                topic=topic,
                key=key,
                error=str(e),
            )
            # Route to DLQ and commit to skip malformed message.
            try:
                await self._route_failed_message(
                    topic=topic,
                    key=key,
                    partition=partition,
                    offset=offset,
                    headers={"drovi_retry_count": str(self._max_retry_attempts)},
                    payload={
                        "decode_error": str(e),
                        "raw_b64": base64.b64encode(msg.value() or b"").decode("utf-8"),
                    },
                    error=e,
                )
                await self._commit_if_possible(topic, partition, offset)
            except Exception as route_exc:
                logger.warning(
                    "Failed to route malformed message to DLQ",
                    topic=topic,
                    partition=partition,
                    offset=offset,
                    error=str(route_exc),
                )

        except Exception as e:
            logger.error(
                "Message processing failed",
                topic=topic,
                key=key,
                error=str(e),
            )
            # Route to retry/DLQ and commit only if routed successfully.
            try:
                # We expect the internal schema to be an envelope with `payload`.
                raw = json.loads(msg.value().decode("utf-8"))
                raw_headers = {}
                if msg.headers():
                    raw_headers = {
                        h[0]: h[1].decode("utf-8") if h[1] else None
                        for h in msg.headers()
                    }
                payload = raw.get("payload") if isinstance(raw, dict) and "payload" in raw else raw
                await self._route_failed_message(
                    topic=topic,
                    key=key,
                    partition=partition,
                    offset=offset,
                    headers=raw_headers,
                    payload=payload,
                    error=e,
                )
                await self._commit_if_possible(topic, partition, offset)
            except Exception as route_exc:
                logger.warning(
                    "Failed to route message to retry/DLQ; leaving uncommitted",
                    topic=topic,
                    partition=partition,
                    offset=offset,
                    error=str(route_exc),
                )

    async def consume_batch(
        self,
        max_messages: int = 100,
        timeout: float = 5.0,
    ) -> list[dict[str, Any]]:
        """
        Consume a batch of messages.

        Useful for batch processing scenarios.

        Args:
            max_messages: Maximum messages to consume
            timeout: Total timeout in seconds

        Returns:
            List of messages
        """
        if not self._consumer:
            return []

        messages = []
        start_time = utc_now()

        while len(messages) < max_messages:
            elapsed = (utc_now() - start_time).total_seconds()
            if elapsed >= timeout:
                break

            remaining = timeout - elapsed
            msg = await asyncio.to_thread(
                self._consumer.poll, timeout=min(1.0, remaining)
            )
            poll_ts = time.time()
            self._metrics.set_kafka_last_poll(self.group_id, poll_ts)

            if msg is None:
                continue

            if msg.error():
                continue

            try:
                value = json.loads(msg.value().decode("utf-8"))
                messages.append({
                    "topic": msg.topic(),
                    "key": msg.key().decode("utf-8") if msg.key() else None,
                    "partition": msg.partition(),
                    "offset": msg.offset(),
                    **value,
                })
            except Exception as e:
                logger.warning("Failed to deserialize message", error=str(e))

        # Commit all consumed messages
        if messages and not self.enable_auto_commit:
            self._consumer.commit(asynchronous=False)

        return messages

    async def _report_consumer_lag(self) -> None:
        """Report Kafka consumer lag metrics."""
        if not self._consumer or not self._metrics.enabled:
            return
        try:
            assignment = await asyncio.to_thread(self._consumer.assignment)
            if not assignment:
                return
            positions = await asyncio.to_thread(self._consumer.position, assignment)
            for tp in positions:
                if tp.offset is None or tp.offset < 0:
                    continue
                low, high = await asyncio.to_thread(
                    self._consumer.get_watermark_offsets,
                    tp,
                    timeout=1.0,
                )
                lag = max(high - tp.offset, 0)
                self._metrics.set_kafka_consumer_lag(
                    self.group_id,
                    tp.topic,
                    tp.partition,
                    lag,
                )
        except Exception as exc:
            logger.warning("Kafka consumer lag report failed", error=str(exc))


async def get_kafka_consumer(
    topics: list[str] | None = None,
) -> DroviKafkaConsumer:
    """Get or create the global Kafka consumer instance."""
    global _kafka_consumer

    if _kafka_consumer is None:
        settings = get_settings()
        default_topics = [
            settings.kafka_topic_raw_events,
            settings.kafka_topic_normalized_records,
            settings.kafka_topic_pipeline_input,
            settings.kafka_topic_graph_changes,
        ]
        _kafka_consumer = DroviKafkaConsumer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=settings.kafka_consumer_group_id,
            topics=topics or default_topics,
            security_protocol=settings.kafka_security_protocol,
            sasl_mechanism=settings.kafka_sasl_mechanism,
            sasl_username=settings.kafka_sasl_username,
            sasl_password=settings.kafka_sasl_password,
            auto_offset_reset=settings.kafka_auto_offset_reset,
            enable_auto_commit=settings.kafka_enable_auto_commit,
            worker_concurrency=settings.kafka_worker_concurrency,
            queue_maxsize=settings.kafka_queue_maxsize,
            topic_priorities=settings.kafka_topic_priorities,
            lag_report_interval_seconds=settings.kafka_lag_report_interval_seconds,
        )
        await _kafka_consumer.connect()

    return _kafka_consumer


async def close_kafka_consumer() -> None:
    """Close the global Kafka consumer."""
    global _kafka_consumer

    if _kafka_consumer:
        await _kafka_consumer.close()
        _kafka_consumer = None


# =============================================================================
# Pre-built Message Handlers
# =============================================================================


class RawEventHandler:
    """Handler for raw webhook events."""

    def __init__(self, orchestrator_callback: Callable | None = None):
        """
        Initialize the raw event handler.

        Args:
            orchestrator_callback: Optional callback to trigger orchestrator
        """
        self.orchestrator_callback = orchestrator_callback

    async def __call__(self, message: dict[str, Any]) -> None:
        """Process a raw event message."""
        payload = message.get("payload", {})
        organization_id = payload.get("organization_id")
        source_type = payload.get("source_type")
        event_type = payload.get("event_type")

        logger.info(
            "Processing raw event",
            organization_id=organization_id,
            source_type=source_type,
            event_type=event_type,
        )

        if self.orchestrator_callback:
            await self.orchestrator_callback(
                organization_id=organization_id,
                source_type=source_type,
                raw_payload=payload.get("payload", {}),
            )


class IntelligenceHandler:
    """Handler for extracted intelligence."""

    def __init__(self, graph_callback: Callable | None = None):
        """
        Initialize the intelligence handler.

        Args:
            graph_callback: Optional callback to persist to graph
        """
        self.graph_callback = graph_callback

    async def __call__(self, message: dict[str, Any]) -> None:
        """Process an intelligence message."""
        payload = message.get("payload", {})
        intelligence_type = payload.get("intelligence_type")
        intelligence_id = payload.get("intelligence_id")
        organization_id = payload.get("organization_id")

        logger.info(
            "Processing intelligence",
            intelligence_type=intelligence_type,
            intelligence_id=intelligence_id,
            organization_id=organization_id,
        )

        if self.graph_callback:
            await self.graph_callback(
                intelligence_type=intelligence_type,
                intelligence_id=intelligence_id,
                organization_id=organization_id,
                data=payload.get("data", {}),
            )


class GraphChangeHandler:
    """Handler for graph change notifications."""

    def __init__(self, broadcast_callback: Callable | None = None):
        """
        Initialize the graph change handler.

        Args:
            broadcast_callback: Optional callback to broadcast via SSE
        """
        self.broadcast_callback = broadcast_callback

    async def __call__(self, message: dict[str, Any]) -> None:
        """Process a graph change message."""
        payload = message.get("payload", {})
        change_type = payload.get("change_type")
        node_type = payload.get("node_type")
        node_id = payload.get("node_id")
        organization_id = payload.get("organization_id")

        logger.debug(
            "Processing graph change",
            change_type=change_type,
            node_type=node_type,
            node_id=node_id,
            organization_id=organization_id,
        )

        if self.broadcast_callback:
            await self.broadcast_callback(
                organization_id=organization_id,
                change_type=change_type,
                node_type=node_type,
                node_id=node_id,
                properties=payload.get("properties", {}),
            )
