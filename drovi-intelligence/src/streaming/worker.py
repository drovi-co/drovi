"""
Kafka Worker Process

Standalone worker that consumes events from Kafka and processes them.
Designed to run as a separate deployment in Kubernetes/Porter.

Usage:
    python -m src.streaming.worker

This worker:
1. Consumes raw events from drovi-raw-events topic
2. Triggers intelligence extraction via orchestrator
3. Writes extracted intelligence to FalkorDB
4. Publishes graph change notifications
"""

import asyncio
import signal
import sys
from typing import Any

import structlog

from src.config import get_settings
from src.streaming.kafka_consumer import DroviKafkaConsumer
from src.streaming.kafka_producer import get_kafka_producer
from src.streaming.falkordb_sink import get_falkordb_sink
from src.db.rls import rls_context

# Configure structured logging
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


class KafkaWorker:
    """
    Kafka worker that processes events from Kafka topics.

    Handles:
    - Raw events → Intelligence extraction
    - Intelligence → FalkorDB persistence
    - Graph changes → SSE broadcast (via Kafka)
    """

    def __init__(self):
        self.settings = get_settings()
        self._consumer: DroviKafkaConsumer | None = None
        self._producer = None
        self._sink = None
        self._running = False
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start the Kafka worker."""
        logger.info(
            "Starting Kafka worker",
            bootstrap_servers=self.settings.kafka_bootstrap_servers,
            consumer_group=self.settings.kafka_consumer_group_id,
        )

        # Initialize producer (for publishing graph changes)
        self._producer = await get_kafka_producer()

        # Initialize FalkorDB sink
        self._sink = await get_falkordb_sink()

        # Initialize consumer
        self._consumer = DroviKafkaConsumer(
            bootstrap_servers=self.settings.kafka_bootstrap_servers,
            group_id=f"{self.settings.kafka_consumer_group_id}-worker",
            topics=[
                self.settings.kafka_topic_raw_events,
                self.settings.kafka_topic_intelligence,
            ],
            security_protocol=self.settings.kafka_security_protocol,
            sasl_mechanism=self.settings.kafka_sasl_mechanism,
            sasl_username=self.settings.kafka_sasl_username,
            sasl_password=self.settings.kafka_sasl_password,
            auto_offset_reset=self.settings.kafka_auto_offset_reset,
            enable_auto_commit=self.settings.kafka_enable_auto_commit,
            worker_concurrency=self.settings.kafka_worker_concurrency,
            queue_maxsize=self.settings.kafka_queue_maxsize,
            topic_priorities=self.settings.kafka_topic_priorities,
        )

        await self._consumer.connect()

        # Register handlers
        self._consumer.register_handler(
            self.settings.kafka_topic_raw_events,
            self._handle_raw_event,
        )
        self._consumer.register_handler(
            self.settings.kafka_topic_intelligence,
            self._handle_intelligence,
        )

        self._running = True
        logger.info("Kafka worker started, consuming events...")

        # Start consuming
        try:
            await self._consumer.start()
        except asyncio.CancelledError:
            logger.info("Kafka worker cancelled")
        except Exception as e:
            logger.error("Kafka worker error", error=str(e))
            raise

    async def stop(self) -> None:
        """Stop the Kafka worker gracefully."""
        logger.info("Stopping Kafka worker...")
        self._running = False

        if self._consumer:
            await self._consumer.stop()
            await self._consumer.close()

        if self._sink:
            await self._sink.flush()
            await self._sink.close()

        if self._producer:
            await self._producer.flush()
            await self._producer.close()

        logger.info("Kafka worker stopped")

    async def _handle_raw_event(self, message: dict[str, Any]) -> None:
        """
        Handle a raw event from connectors.

        Triggers the intelligence extraction pipeline.
        """
        organization_id = message.get("organization_id")
        source_type = message.get("source_type")
        event_type = message.get("event_type")
        raw_payload = message.get("payload", {})

        logger.info(
            "Processing raw event",
            organization_id=organization_id,
            source_type=source_type,
            event_type=event_type,
        )

        try:
            if event_type == "connector.webhook":
                from src.connectors.webhooks.processor import process_connector_webhook_event

                await process_connector_webhook_event(raw_payload)
                return

            # Import orchestrator lazily to avoid circular imports
            from src.orchestrator.run import run_analysis

            # Run intelligence extraction scoped to org
            with rls_context(organization_id, is_internal=True):
                result = await run_analysis(
                    organization_id=organization_id,
                    content=raw_payload,
                    source_type=source_type,
                )

            if result and result.get("uios"):
                logger.info(
                    "Intelligence extracted",
                    organization_id=organization_id,
                    uio_count=len(result.get("uios", [])),
                )

                # Produce intelligence events for each extracted UIO
                for uio in result.get("uios", []):
                    await self._producer.produce_intelligence(
                        organization_id=organization_id,
                        intelligence_type=uio.get("type", "unknown"),
                        intelligence_id=uio.get("id"),
                        data=uio,
                    )

        except Exception as e:
            logger.error(
                "Failed to process raw event",
                organization_id=organization_id,
                error=str(e),
            )

    async def _handle_intelligence(self, message: dict[str, Any]) -> None:
        """
        Handle extracted intelligence.

        Persists to FalkorDB and publishes graph change notification.
        """
        payload = message.get("payload", {})
        intelligence_type = payload.get("intelligence_type")
        intelligence_id = payload.get("intelligence_id")
        organization_id = payload.get("organization_id")
        data = payload.get("data", {})

        logger.debug(
            "Processing intelligence",
            intelligence_type=intelligence_type,
            intelligence_id=intelligence_id,
        )

        try:
            with rls_context(organization_id, is_internal=True):
                # Write to FalkorDB
                await self._sink.write_intelligence(
                    intelligence_type=intelligence_type,
                    intelligence_id=intelligence_id,
                    organization_id=organization_id,
                    data=data,
                )

            # Publish graph change notification
            await self._producer.produce_graph_change(
                organization_id=organization_id,
                change_type="created",
                node_type=intelligence_type.title(),
                node_id=intelligence_id,
                properties=data,
            )

            logger.info(
                "Intelligence persisted",
                intelligence_type=intelligence_type,
                intelligence_id=intelligence_id,
            )

        except Exception as e:
            logger.error(
                "Failed to persist intelligence",
                intelligence_type=intelligence_type,
                intelligence_id=intelligence_id,
                error=str(e),
            )


async def main() -> None:
    """Main entry point for the Kafka worker."""
    settings = get_settings()

    if not settings.kafka_enabled:
        logger.error("Kafka is not enabled. Set KAFKA_ENABLED=true to run the worker.")
        sys.exit(1)

    worker = KafkaWorker()

    # Set up signal handlers for graceful shutdown
    loop = asyncio.get_event_loop()

    def signal_handler():
        logger.info("Received shutdown signal")
        asyncio.create_task(worker.stop())

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, signal_handler)

    try:
        await worker.start()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
