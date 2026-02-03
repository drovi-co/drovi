"""
FalkorDB Stream Sink

Direct streaming writes to FalkorDB for sub-second latency.
Supports batching, upserts, and change data capture.

Features:
- Async batch writes
- MERGE (upsert) support
- Automatic retry with backoff
- Change notification publishing
"""

import asyncio
import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import structlog

from src.config import get_settings
from src.graph.client import get_graph_client, DroviGraph
from src.graph.types import GraphNodeType

logger = structlog.get_logger()

# Global sink instance
_falkordb_sink: "FalkorDBStreamSink | None" = None


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FalkorDBStreamSink:
    """
    FalkorDB streaming sink for real-time graph writes.

    Features:
    - Direct writes with sub-second latency
    - Batched writes for throughput optimization
    - Change event publishing for SSE subscriptions
    - Automatic retry with exponential backoff
    """

    def __init__(
        self,
        batch_size: int = 50,
        flush_interval_ms: int = 100,
        max_retries: int = 3,
        retry_backoff_ms: int = 100,
    ):
        """
        Initialize the FalkorDB sink.

        Args:
            batch_size: Max records before auto-flush
            flush_interval_ms: Max time before auto-flush
            max_retries: Max retry attempts
            retry_backoff_ms: Initial retry backoff
        """
        self.batch_size = batch_size
        self.flush_interval_ms = flush_interval_ms
        self.max_retries = max_retries
        self.retry_backoff_ms = retry_backoff_ms
        self._graph: DroviGraph | None = None
        self._batch: list[dict[str, Any]] = []
        self._batch_lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._running = False
        self._change_callbacks: list[Callable] = []

    async def connect(self) -> None:
        """Initialize connection to FalkorDB."""
        self._graph = await get_graph_client()
        self._running = True

        # Start periodic flush task
        self._flush_task = asyncio.create_task(self._periodic_flush())

        logger.info("FalkorDB stream sink connected")

    async def close(self) -> None:
        """Flush remaining records and close."""
        self._running = False

        # Cancel flush task
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # Final flush
        await self.flush()

        self._graph = None
        logger.info("FalkorDB stream sink closed")

    def on_change(self, callback: Callable) -> None:
        """
        Register a callback for change notifications.

        Args:
            callback: Async function(change_type, node_type, node_id, properties)
        """
        self._change_callbacks.append(callback)

    async def _notify_change(
        self,
        change_type: str,
        node_type: str,
        node_id: str,
        organization_id: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        """Notify all registered callbacks of a graph change."""
        for callback in self._change_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(
                        change_type=change_type,
                        node_type=node_type,
                        node_id=node_id,
                        organization_id=organization_id,
                        properties=properties or {},
                    )
                else:
                    callback(
                        change_type=change_type,
                        node_type=node_type,
                        node_id=node_id,
                        organization_id=organization_id,
                        properties=properties or {},
                    )
            except Exception as e:
                logger.warning(
                    "Change callback failed",
                    error=str(e),
                    node_type=node_type,
                    node_id=node_id,
                )

    async def write_node(
        self,
        node_type: str,
        node_id: str,
        organization_id: str,
        properties: dict[str, Any],
        upsert: bool = True,
    ) -> bool:
        """
        Write a single node to FalkorDB.

        Args:
            node_type: Node label (Commitment, Decision, etc.)
            node_id: Node identifier
            organization_id: Organization identifier
            properties: Node properties
            upsert: If True, use MERGE; if False, use CREATE

        Returns:
            True if successful
        """
        record = {
            "type": "node",
            "operation": "upsert" if upsert else "create",
            "node_type": node_type,
            "node_id": node_id,
            "organization_id": organization_id,
            "properties": properties,
        }

        async with self._batch_lock:
            self._batch.append(record)

            if len(self._batch) >= self.batch_size:
                await self._flush_batch()

        return True

    async def write_relationship(
        self,
        from_type: str,
        from_id: str,
        to_type: str,
        to_id: str,
        rel_type: str,
        properties: dict[str, Any] | None = None,
        upsert: bool = True,
    ) -> bool:
        """
        Write a relationship to FalkorDB.

        Args:
            from_type: Source node type
            from_id: Source node ID
            to_type: Target node type
            to_id: Target node ID
            rel_type: Relationship type
            properties: Relationship properties
            upsert: If True, use MERGE

        Returns:
            True if successful
        """
        record = {
            "type": "relationship",
            "operation": "upsert" if upsert else "create",
            "from_type": from_type,
            "from_id": from_id,
            "to_type": to_type,
            "to_id": to_id,
            "rel_type": rel_type,
            "properties": properties or {},
        }

        async with self._batch_lock:
            self._batch.append(record)

            if len(self._batch) >= self.batch_size:
                await self._flush_batch()

        return True

    async def write_intelligence(
        self,
        intelligence_type: str,
        intelligence_id: str,
        organization_id: str,
        data: dict[str, Any],
    ) -> bool:
        """
        Write extracted intelligence to the graph.

        Handles different intelligence types (Commitment, Decision, etc.)
        with appropriate node creation and relationships.

        Args:
            intelligence_type: Type of intelligence
            intelligence_id: Intelligence object ID
            organization_id: Organization identifier
            data: Intelligence data

        Returns:
            True if successful
        """
        # Map intelligence types to node types
        node_type_map = {
            "commitment": "Commitment",
            "decision": "Decision",
            "risk": "Risk",
            "task": "Task",
            "claim": "Claim",
            "question": "Question",
        }

        node_type = node_type_map.get(
            intelligence_type.lower(),
            intelligence_type.title(),
        )

        now = utc_now().isoformat()

        # Prepare properties
        properties = {
            "id": intelligence_id,
            "organizationId": organization_id,
            "createdAt": now,
            "updatedAt": now,
            **data,
        }

        # Handle nested objects
        for key, value in properties.items():
            if isinstance(value, (dict, list)):
                properties[key] = json.dumps(value)
            elif isinstance(value, datetime):
                properties[key] = value.isoformat()

        return await self.write_node(
            node_type=node_type,
            node_id=intelligence_id,
            organization_id=organization_id,
            properties=properties,
            upsert=True,
        )

    async def flush(self) -> int:
        """
        Flush the current batch to FalkorDB.

        Returns:
            Number of records flushed
        """
        async with self._batch_lock:
            return await self._flush_batch()

    async def _flush_batch(self) -> int:
        """Internal batch flush (must hold lock)."""
        if not self._batch:
            return 0

        batch = self._batch.copy()
        self._batch = []

        count = 0
        for record in batch:
            success = await self._write_record_with_retry(record)
            if success:
                count += 1

        logger.debug("Flushed batch", count=count, total=len(batch))
        return count

    async def _write_record_with_retry(self, record: dict[str, Any]) -> bool:
        """Write a single record with retry logic."""
        for attempt in range(self.max_retries):
            try:
                return await self._write_record(record)
            except Exception as e:
                if attempt == self.max_retries - 1:
                    logger.error(
                        "Failed to write record after retries",
                        record_type=record.get("type"),
                        error=str(e),
                    )
                    return False

                backoff = self.retry_backoff_ms * (2 ** attempt) / 1000
                logger.warning(
                    "Write failed, retrying",
                    attempt=attempt + 1,
                    backoff=backoff,
                    error=str(e),
                )
                await asyncio.sleep(backoff)

        return False

    async def _write_record(self, record: dict[str, Any]) -> bool:
        """Write a single record to FalkorDB."""
        if not self._graph:
            raise RuntimeError("Not connected to FalkorDB")

        record_type = record.get("type")
        operation = record.get("operation", "upsert")

        if record_type == "node":
            return await self._write_node_record(record, operation)
        elif record_type == "relationship":
            return await self._write_relationship_record(record, operation)
        else:
            logger.warning("Unknown record type", record_type=record_type)
            return False

    async def _write_node_record(
        self,
        record: dict[str, Any],
        operation: str,
    ) -> bool:
        """Write a node record to FalkorDB."""
        node_type = record["node_type"]
        node_id = record["node_id"]
        organization_id = record["organization_id"]
        properties = record["properties"]

        # Build property clause
        props_clause, params = self._graph.build_create_properties(properties)

        if operation == "upsert":
            # MERGE with ON CREATE and ON MATCH
            query = f"""
                MERGE (n:{node_type} {{id: $nodeId}})
                ON CREATE SET {props_clause}
                ON MATCH SET n.updatedAt = $prop_updatedAt
                RETURN n.id as id
            """
        else:
            # CREATE
            query = f"""
                CREATE (n:{node_type} {{{props_clause}}})
                RETURN n.id as id
            """

        params["nodeId"] = node_id

        await self._graph.query(query, params)

        # Notify change
        await self._notify_change(
            change_type="created" if operation == "create" else "upserted",
            node_type=node_type,
            node_id=node_id,
            organization_id=organization_id,
            properties=properties,
        )

        return True

    async def _write_relationship_record(
        self,
        record: dict[str, Any],
        operation: str,
    ) -> bool:
        """Write a relationship record to FalkorDB."""
        from_type = record["from_type"]
        from_id = record["from_id"]
        to_type = record["to_type"]
        to_id = record["to_id"]
        rel_type = record["rel_type"]
        properties = record.get("properties", {})

        if operation == "upsert":
            # MERGE relationship
            props_str = ", ".join(
                f"r.{k} = ${k}" for k in properties.keys()
            ) if properties else ""
            set_clause = f"SET {props_str}" if props_str else ""

            query = f"""
                MATCH (a:{from_type} {{id: $fromId}})
                MATCH (b:{to_type} {{id: $toId}})
                MERGE (a)-[r:{rel_type}]->(b)
                {set_clause}
                RETURN type(r) as relType
            """
        else:
            # CREATE relationship
            props_clause, extra_params = self._graph.build_create_properties(properties)
            props_str = f"{{{props_clause}}}" if props_clause else ""

            query = f"""
                MATCH (a:{from_type} {{id: $fromId}})
                MATCH (b:{to_type} {{id: $toId}})
                CREATE (a)-[r:{rel_type} {props_str}]->(b)
                RETURN type(r) as relType
            """
            properties.update(extra_params)

        params = {
            "fromId": from_id,
            "toId": to_id,
            **properties,
        }

        await self._graph.query(query, params)
        return True

    async def _periodic_flush(self) -> None:
        """Periodically flush the batch."""
        interval = self.flush_interval_ms / 1000

        while self._running:
            await asyncio.sleep(interval)

            async with self._batch_lock:
                if self._batch:
                    await self._flush_batch()


async def get_falkordb_sink(
    batch_size: int = 50,
    flush_interval_ms: int = 100,
) -> FalkorDBStreamSink:
    """Get or create the global FalkorDB sink instance."""
    global _falkordb_sink

    if _falkordb_sink is None:
        _falkordb_sink = FalkorDBStreamSink(
            batch_size=batch_size,
            flush_interval_ms=flush_interval_ms,
        )
        await _falkordb_sink.connect()

    return _falkordb_sink


async def close_falkordb_sink() -> None:
    """Close the global FalkorDB sink."""
    global _falkordb_sink

    if _falkordb_sink:
        await _falkordb_sink.close()
        _falkordb_sink = None


# =============================================================================
# Stream Processing Pipeline
# =============================================================================


class StreamProcessor:
    """
    Stream processing pipeline connecting Kafka to FalkorDB.

    Orchestrates:
    1. Kafka consumer for raw events
    2. Normalization and enrichment
    3. Intelligence extraction
    4. Change notification publishing
    """

    def __init__(self):
        """Initialize the stream processor."""
        self._producer = None
        self._consumer = None
        self._consumer_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Start the stream processing pipeline."""
        from .kafka_producer import get_kafka_producer
        from .kafka_consumer import get_kafka_consumer

        settings = get_settings()

        # Initialize components
        self._producer = await get_kafka_producer()
        topics = [
            settings.kafka_topic_normalized_records,
            settings.kafka_topic_pipeline_input,
        ]
        if settings.kafka_raw_event_mode != "disabled":
            topics.insert(0, settings.kafka_topic_raw_events)
        self._consumer = await get_kafka_consumer(topics)

        # Register handlers
        if settings.kafka_raw_event_mode != "disabled":
            self._consumer.register_handler(
                settings.kafka_topic_raw_events,
                self._handle_raw_event,
            )
        self._consumer.register_handler(
            settings.kafka_topic_normalized_records,
            self._handle_normalized_record,
        )
        self._consumer.register_handler(
            settings.kafka_topic_pipeline_input,
            self._handle_pipeline_input,
        )

        # Start consumer loop in the background to avoid blocking app startup
        self._running = True
        self._consumer_task = asyncio.create_task(self._consumer.start())

    async def stop(self) -> None:
        """Stop the stream processing pipeline."""
        self._running = False

        if self._consumer:
            await self._consumer.stop()

        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
            self._consumer_task = None

    async def _handle_raw_event(self, message: dict[str, Any]) -> None:
        """Handle a raw event from Kafka."""
        from src.streaming.ingestion_pipeline import normalize_raw_event_payload

        payload = message.get("payload", {})
        event_type = payload.get("event_type")
        settings = get_settings()

        if settings.kafka_raw_event_mode == "webhook_only" and event_type != "connector.webhook":
            return

        if event_type == "connector.webhook":
            from src.connectors.webhooks.processor import process_connector_webhook_event

            await process_connector_webhook_event(payload)
            return

        normalized_event = normalize_raw_event_payload(payload)
        if not normalized_event:
            return

        await self._producer.produce_normalized_record(
            organization_id=normalized_event.organization_id,
            record_id=normalized_event.normalized_id,
            data=normalized_event.to_payload(),
            priority=normalized_event.ingest.get("priority"),
        )

    async def _handle_normalized_record(self, message: dict[str, Any]) -> None:
        """Enrich normalized records and enqueue pipeline input."""
        from src.streaming.ingestion_pipeline import (
            NormalizedRecordEvent,
            enrich_normalized_payload,
        )

        payload = message.get("payload", {})
        normalized_event = NormalizedRecordEvent(**payload)
        pipeline_event = await enrich_normalized_payload(normalized_event)
        await self._producer.produce_pipeline_input(
            organization_id=pipeline_event.organization_id,
            pipeline_id=pipeline_event.pipeline_id,
            data=pipeline_event.to_payload(),
            priority=pipeline_event.ingest.get("priority"),
        )

    async def _handle_pipeline_input(self, message: dict[str, Any]) -> None:
        """Run intelligence extraction for pipeline input."""
        from src.orchestrator.graph import run_intelligence_extraction
        from src.db.rls import rls_context
        from src.monitoring import get_metrics
        from src.db import get_db_pool
        from datetime import datetime

        payload = message.get("payload", {})
        organization_id = payload.get("organization_id")
        source_type = payload.get("source_type") or "api"
        content = payload.get("content") or ""
        ingest = payload.get("ingest") or {}

        if not organization_id or not content:
            logger.warning("Pipeline input missing required fields", payload=payload)
            return

        content_hash = ingest.get("content_hash")
        if content_hash:
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
                if row:
                    logger.info(
                        "Skipping duplicate pipeline input",
                        organization_id=organization_id,
                        content_hash=content_hash,
                    )
                    return
            except Exception:
                pass

        metrics = get_metrics()
        started_at = datetime.utcnow()
        try:
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
            logger.error("Pipeline input failed", error=str(exc))
