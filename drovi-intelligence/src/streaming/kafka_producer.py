"""
Kafka Producer

Produces events to Kafka topics for real-time processing.
Supports batching, compression, and delivery guarantees.

Topics:
- raw.connector.events: Raw connector events (immediate write)
- normalized.records: Normalized records for pipeline input
- intelligence.pipeline.input: Pipeline input for extraction
- drovi-intelligence: Extracted intelligence objects
- graph.changes: Graph change notifications
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import structlog

from src.config import get_settings

logger = structlog.get_logger()

# Global producer instance
_kafka_producer: "DroviKafkaProducer | None" = None


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class DroviKafkaProducer:
    """
    Kafka producer for the Drovi Intelligence Platform.

    Features:
    - Async event production
    - Automatic batching and compression
    - Delivery callbacks for reliability
    - Schema-validated payloads
    """

    def __init__(
        self,
        bootstrap_servers: str,
        security_protocol: str = "PLAINTEXT",
        sasl_mechanism: str | None = None,
        sasl_username: str | None = None,
        sasl_password: str | None = None,
        batch_size: int = 100,
        linger_ms: int = 10,
    ):
        """Initialize Kafka producer."""
        self.bootstrap_servers = bootstrap_servers
        self.security_protocol = security_protocol
        self.sasl_mechanism = sasl_mechanism
        self.sasl_username = sasl_username
        self.sasl_password = sasl_password
        self.batch_size = batch_size
        self.linger_ms = linger_ms
        self._producer = None
        self._delivery_callbacks: dict[str, asyncio.Future] = {}

    async def connect(self) -> None:
        """Initialize the Kafka producer connection."""
        try:
            from confluent_kafka import Producer

            config = {
                "bootstrap.servers": self.bootstrap_servers,
                "security.protocol": self.security_protocol,
                "batch.size": self.batch_size,
                "linger.ms": self.linger_ms,
                "compression.type": "lz4",
                "acks": "all",
                "enable.idempotence": True,
                "retries": 3,
                "retry.backoff.ms": 100,
            }

            # SASL authentication (required for Upstash Kafka)
            if self.sasl_mechanism:
                config["sasl.mechanism"] = self.sasl_mechanism
                if self.sasl_username:
                    config["sasl.username"] = self.sasl_username
                if self.sasl_password:
                    config["sasl.password"] = self.sasl_password

            # For SASL_SSL (Upstash), we need to handle SSL config
            if self.security_protocol == "SASL_SSL":
                # Upstash uses public CAs, so we don't need custom certs
                # librdkafka will use system CA store by default
                pass

            self._producer = Producer(config)

            logger.info(
                "Kafka producer connected",
                bootstrap_servers=self.bootstrap_servers,
            )
        except ImportError:
            logger.warning(
                "confluent-kafka not installed, producer running in mock mode"
            )
            self._producer = None
        except Exception as e:
            logger.error("Failed to connect Kafka producer", error=str(e))
            raise

    async def close(self) -> None:
        """Flush and close the producer."""
        if self._producer:
            # Flush any remaining messages
            self._producer.flush(timeout=10)
            self._producer = None
            logger.info("Kafka producer closed")

    def _delivery_callback(self, err, msg) -> None:
        """Callback for message delivery reports."""
        msg_id = msg.key().decode("utf-8") if msg.key() else None

        if err:
            logger.error(
                "Message delivery failed",
                topic=msg.topic(),
                key=msg_id,
                error=str(err),
            )
            if msg_id and msg_id in self._delivery_callbacks:
                self._delivery_callbacks[msg_id].set_exception(
                    Exception(f"Delivery failed: {err}")
                )
        else:
            logger.debug(
                "Message delivered",
                topic=msg.topic(),
                partition=msg.partition(),
                offset=msg.offset(),
            )
            if msg_id and msg_id in self._delivery_callbacks:
                self._delivery_callbacks[msg_id].set_result(True)

    async def produce(
        self,
        topic: str,
        value: dict[str, Any],
        key: str | None = None,
        headers: dict[str, str] | None = None,
        wait_for_delivery: bool = False,
    ) -> str:
        """
        Produce a message to a Kafka topic.

        Args:
            topic: Target Kafka topic
            value: Message payload (will be JSON serialized)
            key: Optional message key for partitioning
            headers: Optional message headers
            wait_for_delivery: If True, wait for delivery confirmation

        Returns:
            Message ID
        """
        msg_id = key or str(uuid4())
        timestamp = utc_now().isoformat()

        # Add metadata to payload
        enriched_value = {
            "message_id": msg_id,
            "timestamp": timestamp,
            "payload": value,
        }

        serialized_value = json.dumps(enriched_value).encode("utf-8")
        serialized_key = msg_id.encode("utf-8")

        # Convert headers to Kafka format
        kafka_headers = []
        if headers:
            kafka_headers = [
                (k, v.encode("utf-8"))
                for k, v in headers.items()
                if v is not None
            ]

        if self._producer:
            # Create delivery future if waiting
            if wait_for_delivery:
                future = asyncio.get_event_loop().create_future()
                self._delivery_callbacks[msg_id] = future

            self._producer.produce(
                topic=topic,
                value=serialized_value,
                key=serialized_key,
                headers=kafka_headers,
                callback=self._delivery_callback,
            )

            # Poll to trigger callbacks
            self._producer.poll(0)

            if wait_for_delivery:
                try:
                    await asyncio.wait_for(future, timeout=30.0)
                finally:
                    self._delivery_callbacks.pop(msg_id, None)
        else:
            # Mock mode - just log
            logger.debug(
                "Mock produce",
                topic=topic,
                key=msg_id,
                value_size=len(serialized_value),
            )

        return msg_id

    async def produce_raw_event(
        self,
        organization_id: str,
        source_type: str,
        event_type: str,
        payload: dict[str, Any],
        source_id: str | None = None,
        priority: str | int | None = None,
    ) -> str:
        """
        Produce a raw event from a webhook or connector.

        Args:
            organization_id: Organization identifier
            source_type: Source type (email, slack, etc.)
            event_type: Event type (message.received, etc.)
            payload: Raw event payload
            source_id: Optional source identifier

        Returns:
            Event ID
        """
        settings = get_settings()
        event_id = str(uuid4())

        event = {
            "event_id": event_id,
            "organization_id": organization_id,
            "source_type": source_type,
            "event_type": event_type,
            "source_id": source_id,
            "payload": payload,
        }

        await self.produce(
            topic=settings.kafka_topic_raw_events,
            value=event,
            key=f"{organization_id}:{event_id}",
            headers={
                "organization_id": organization_id,
                "source_type": source_type,
                "event_type": event_type,
                "priority": str(priority) if priority is not None else None,
            },
        )

        logger.info(
            "Raw event produced",
            event_id=event_id,
            organization_id=organization_id,
            source_type=source_type,
            event_type=event_type,
        )

        return event_id

    async def produce_intelligence(
        self,
        organization_id: str,
        intelligence_type: str,
        intelligence_id: str,
        data: dict[str, Any],
        analysis_id: str | None = None,
    ) -> str:
        """
        Produce extracted intelligence to the intelligence topic.

        Args:
            organization_id: Organization identifier
            intelligence_type: Type (commitment, decision, risk, task, etc.)
            intelligence_id: Intelligence object ID
            data: Intelligence data
            analysis_id: Optional analysis ID for tracing

        Returns:
            Message ID
        """
        settings = get_settings()

        intelligence = {
            "intelligence_type": intelligence_type,
            "intelligence_id": intelligence_id,
            "organization_id": organization_id,
            "analysis_id": analysis_id,
            "data": data,
        }

        msg_id = await self.produce(
            topic=settings.kafka_topic_intelligence,
            value=intelligence,
            key=f"{organization_id}:{intelligence_type}:{intelligence_id}",
            headers={
                "organization_id": organization_id,
                "intelligence_type": intelligence_type,
            },
        )

        logger.debug(
            "Intelligence produced",
            intelligence_type=intelligence_type,
            intelligence_id=intelligence_id,
            organization_id=organization_id,
        )

        return msg_id

    async def produce_normalized_record(
        self,
        organization_id: str,
        record_id: str,
        data: dict[str, Any],
        priority: str | int | None = None,
    ) -> str:
        """Produce a normalized record event."""
        settings = get_settings()
        msg_id = await self.produce(
            topic=settings.kafka_topic_normalized_records,
            value=data,
            key=f"{organization_id}:{record_id}",
            headers={
                "organization_id": organization_id,
                "priority": str(priority) if priority is not None else None,
            },
        )
        return msg_id

    async def produce_pipeline_input(
        self,
        organization_id: str,
        pipeline_id: str,
        data: dict[str, Any],
        priority: str | int | None = None,
    ) -> str:
        """Produce an intelligence pipeline input event."""
        settings = get_settings()
        msg_id = await self.produce(
            topic=settings.kafka_topic_pipeline_input,
            value=data,
            key=f"{organization_id}:{pipeline_id}",
            headers={
                "organization_id": organization_id,
                "priority": str(priority) if priority is not None else None,
            },
        )
        return msg_id

    async def produce_graph_change(
        self,
        organization_id: str,
        change_type: str,
        node_type: str,
        node_id: str,
        properties: dict[str, Any] | None = None,
        relationships: list[dict[str, Any]] | None = None,
    ) -> str:
        """
        Produce a graph change notification.

        Used for real-time subscriptions (SSE).

        Args:
            organization_id: Organization identifier
            change_type: Change type (created, updated, deleted)
            node_type: Node type (Commitment, Decision, etc.)
            node_id: Node identifier
            properties: Optional changed properties
            relationships: Optional related relationships

        Returns:
            Message ID
        """
        settings = get_settings()

        change = {
            "change_type": change_type,
            "node_type": node_type,
            "node_id": node_id,
            "organization_id": organization_id,
            "properties": properties or {},
            "relationships": relationships or [],
        }

        msg_id = await self.produce(
            topic=settings.kafka_topic_graph_changes,
            value=change,
            key=f"{organization_id}:{node_type}:{node_id}",
            headers={
                "organization_id": organization_id,
                "change_type": change_type,
                "node_type": node_type,
            },
        )

        logger.debug(
            "Graph change produced",
            change_type=change_type,
            node_type=node_type,
            node_id=node_id,
        )

        return msg_id

    async def flush(self, timeout: float = 10.0) -> None:
        """Flush all pending messages."""
        if self._producer:
            self._producer.flush(timeout=timeout)


async def get_kafka_producer() -> DroviKafkaProducer:
    """Get or create the global Kafka producer instance."""
    global _kafka_producer

    if _kafka_producer is None:
        settings = get_settings()
        _kafka_producer = DroviKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            security_protocol=settings.kafka_security_protocol,
            sasl_mechanism=settings.kafka_sasl_mechanism,
            sasl_username=settings.kafka_sasl_username,
            sasl_password=settings.kafka_sasl_password,
            batch_size=settings.kafka_batch_size,
            linger_ms=settings.kafka_linger_ms,
        )
        await _kafka_producer.connect()

    return _kafka_producer


async def close_kafka_producer() -> None:
    """Close the global Kafka producer."""
    global _kafka_producer

    if _kafka_producer:
        await _kafka_producer.close()
        _kafka_producer = None
