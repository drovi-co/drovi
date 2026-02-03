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
import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import structlog

from src.config import get_settings
from src.ingestion.priority import parse_priority_value

logger = structlog.get_logger()

# Global consumer instance
_kafka_consumer: "DroviKafkaConsumer | None" = None


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
            self._consumer.subscribe(self.topics)

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
                            logger.warning("Kafka consumer paused due to backpressure")

                if self._queue:
                    await self._enqueue_message(msg)

                # Resume when queue drains
                if self._paused and self._queue and self._queue.qsize() <= int(self.queue_maxsize * 0.4):
                    assignment = self._consumer.assignment()
                    if assignment:
                        self._consumer.resume(assignment)
                        self._paused = False
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
        priority = self._resolve_priority(msg, topic)
        self._counter += 1
        await self._queue.put((priority, self._counter, msg))

    def _resolve_priority(self, msg, topic: str) -> int:
        """Resolve priority from headers or topic defaults (lower = higher priority)."""
        default_priority = self.topic_priorities.get(topic, 10)
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
            if topic in self._handlers:
                handler = self._handlers[topic]
                if asyncio.iscoroutinefunction(handler):
                    await handler(message)
                else:
                    handler(message)
            elif self._default_handler:
                if asyncio.iscoroutinefunction(self._default_handler):
                    await self._default_handler(topic, message)
                else:
                    self._default_handler(topic, message)
            else:
                logger.warning("No handler for topic", topic=topic)

            # Commit offset after successful processing
            if not self.enable_auto_commit:
                self._consumer.commit(message=msg, asynchronous=False)

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
            # Commit to skip malformed message
            if not self.enable_auto_commit:
                self._consumer.commit(message=msg, asynchronous=False)

        except Exception as e:
            logger.error(
                "Message processing failed",
                topic=topic,
                key=key,
                error=str(e),
            )
            # Don't commit - will retry on next poll

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
