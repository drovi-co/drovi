"""
Kafka Worker Process

Standalone worker that consumes events from Kafka and processes them.
Designed to run as a separate deployment in Kubernetes/Porter.

Usage:
    python -m src.streaming.worker

This worker:
1. Consumes raw connector events
2. Normalizes payloads into canonical records
3. Enriches records with identity context
4. Runs intelligence extraction and publishes graph changes
"""

import asyncio
from datetime import datetime
import signal
import sys
from typing import Any

import structlog

from src.config import get_settings
from src.streaming.kafka_consumer import DroviKafkaConsumer
from src.streaming.kafka_producer import get_kafka_producer
from src.db.rls import rls_context
from src.streaming.ingestion_pipeline import (
    NormalizedRecordEvent,
    enrich_normalized_payload,
    normalize_raw_event_payload,
)
from src.monitoring import get_metrics
from src.db import get_db_pool

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
    - Raw events → Normalized records
    - Normalized records → Pipeline input
    - Pipeline input → Intelligence extraction + graph changes
    """

    def __init__(self):
        self.settings = get_settings()
        self._consumer: DroviKafkaConsumer | None = None
        self._producer = None
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

        # Initialize consumer
        topics = [
            self.settings.kafka_topic_normalized_records,
            self.settings.kafka_topic_pipeline_input,
        ]
        if self.settings.kafka_raw_event_mode != "disabled":
            topics.insert(0, self.settings.kafka_topic_raw_events)

        # Subscribe to retry topics as well (DLQs are operator-only).
        retry_suffix = self.settings.kafka_retry_suffix
        if retry_suffix:
            retry_topics = [f"{t}{retry_suffix}" for t in topics if not t.endswith(retry_suffix)]
            for t in retry_topics:
                if t not in topics:
                    topics.append(t)

        self._consumer = DroviKafkaConsumer(
            bootstrap_servers=self.settings.kafka_bootstrap_servers,
            group_id=f"{self.settings.kafka_consumer_group_id}-worker",
            topics=topics,
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
        if self.settings.kafka_raw_event_mode != "disabled":
            self._consumer.register_handler(
                self.settings.kafka_topic_raw_events,
                self._handle_raw_event,
            )
        self._consumer.register_handler(
            self.settings.kafka_topic_normalized_records,
            self._handle_normalized_record,
        )
        self._consumer.register_handler(
            self.settings.kafka_topic_pipeline_input,
            self._handle_pipeline_input,
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

        if self._producer:
            await self._producer.flush()
            await self._producer.close()

        logger.info("Kafka worker stopped")

    async def _handle_raw_event(self, message: dict[str, Any]) -> None:
        """Handle a raw connector event and normalize it."""
        payload = message.get("payload", {})
        event_type = payload.get("event_type")
        organization_id = payload.get("organization_id")
        origin_timestamp = message.get("timestamp")

        if self.settings.kafka_raw_event_mode == "webhook_only" and event_type != "connector.webhook":
            return

        if event_type == "connector.webhook":
            from src.connectors.webhooks.processor import process_connector_webhook_event

            await process_connector_webhook_event(payload)
            return

        try:
            normalized_event = normalize_raw_event_payload(payload, kafka_timestamp=str(origin_timestamp) if origin_timestamp else None)
            if not normalized_event:
                return

            await self._producer.produce_normalized_record(
                organization_id=normalized_event.organization_id,
                record_id=normalized_event.normalized_id,
                data=normalized_event.to_payload(),
                priority=normalized_event.ingest.get("priority"),
            )
        except Exception as exc:
            logger.error(
                "Failed to normalize raw event",
                organization_id=organization_id,
                error=str(exc),
            )

    async def _handle_normalized_record(self, message: dict[str, Any]) -> None:
        """Enrich normalized records and enqueue pipeline input."""
        payload = message.get("payload", {})
        try:
            normalized_event = NormalizedRecordEvent(**payload)
            pipeline_event = await enrich_normalized_payload(normalized_event)
            await self._producer.produce_pipeline_input(
                organization_id=pipeline_event.organization_id,
                pipeline_id=pipeline_event.pipeline_id,
                data=pipeline_event.to_payload(),
                priority=pipeline_event.ingest.get("priority"),
            )
        except Exception as exc:
            logger.error("Failed to enrich normalized record", error=str(exc))

    async def _handle_pipeline_input(self, message: dict[str, Any]) -> None:
        """Run the intelligence extraction pipeline and publish graph changes."""
        payload = message.get("payload", {})
        organization_id = payload.get("organization_id")
        source_type = payload.get("source_type") or "api"
        content = payload.get("content") or ""
        ingest = payload.get("ingest") or {}

        if not organization_id or not content:
            logger.warning("Pipeline input missing required fields", payload=payload)
            return

        if await self._is_duplicate_event(organization_id, ingest.get("content_hash")):
            logger.info(
                "Skipping duplicate pipeline input",
                organization_id=organization_id,
                content_hash=ingest.get("content_hash"),
            )
            return

        from src.orchestrator.graph import run_intelligence_extraction

        metrics = get_metrics()
        started_at = datetime.utcnow()

        try:
            # End-to-end lag: raw ingest -> extraction
            try:
                origin_ts = ingest.get("origin_ts")
                if origin_ts:
                    from datetime import datetime as _dt
                    origin_dt = _dt.fromisoformat(str(origin_ts).replace("Z", "+00:00")).replace(tzinfo=None)
                    metrics.observe_pipeline_end_to_end_lag(
                        source_type=source_type,
                        lag_seconds=(started_at - origin_dt).total_seconds(),
                    )
            except Exception:
                pass

            with rls_context(organization_id, is_internal=True):
                result_state = await run_intelligence_extraction(
                    organization_id=organization_id,
                    content=content,
                    source_type=source_type,
                    source_id=payload.get("source_id"),
                    source_account_id=payload.get("connection_id"),
                    conversation_id=payload.get("conversation_id"),
                    message_ids=payload.get("message_ids"),
                    user_email=payload.get("user_email"),
                    user_name=payload.get("user_name"),
                    metadata=payload.get("metadata"),
                    candidate_only=bool(payload.get("candidate_only") or payload.get("is_partial")),
                )

            duration = (datetime.utcnow() - started_at).total_seconds()
            output = result_state.output.model_dump() if result_state else {}
            uios = output.get("uios") or output.get("uios_created") or []

            metrics.track_extraction(
                organization_id=organization_id,
                source_type=source_type,
                status="ok",
                duration=duration,
                uio_counts={
                    "commitment": len([u for u in uios if u.get("type") == "commitment"]),
                    "decision": len([u for u in uios if u.get("type") == "decision"]),
                    "risk": len([u for u in uios if u.get("type") == "risk"]),
                    "task": len([u for u in uios if u.get("type") == "task"]),
                },
            )

            for uio in uios:
                await self._producer.produce_intelligence(
                    organization_id=organization_id,
                    intelligence_type=uio.get("type", "unknown"),
                    intelligence_id=uio.get("id"),
                    data=uio,
                )

                await self._producer.produce_graph_change(
                    organization_id=organization_id,
                    change_type="created",
                    node_type=uio.get("type", "unknown").title(),
                    node_id=uio.get("id"),
                    properties=uio,
                )

        except Exception as exc:
            duration = (datetime.utcnow() - started_at).total_seconds()
            metrics.track_extraction(
                organization_id=organization_id,
                source_type=source_type,
                status="error",
                duration=duration,
            )
            logger.error(
                "Failed to process pipeline input",
                organization_id=organization_id,
                error=str(exc),
            )

    async def _is_duplicate_event(self, organization_id: str, content_hash: str | None) -> bool:
        if not content_hash:
            return False
        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT 1 FROM unified_event
                    WHERE organization_id = $1 AND content_hash = $2
                    """,
                    organization_id,
                    content_hash,
                )
            return bool(row)
        except Exception:
            return False


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
