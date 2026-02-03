"""
Prometheus Metrics

Defines and exports metrics for monitoring the intelligence backend.
"""

from contextlib import contextmanager
from functools import wraps
import time
from typing import Any, Callable

import structlog

logger = structlog.get_logger()

# Singleton metrics instance
_metrics: "Metrics | None" = None


class Metrics:
    """
    Prometheus metrics for the intelligence backend.

    Tracks:
    - HTTP request latency and counts
    - Intelligence extraction metrics
    - Sync job metrics
    - Graph operations
    - LLM usage
    """

    def __init__(self):
        """Initialize Prometheus metrics."""
        try:
            from prometheus_client import Counter, Histogram, Gauge, Info

            # HTTP request metrics
            self.http_requests_total = Counter(
                "drovi_http_requests_total",
                "Total HTTP requests",
                ["method", "endpoint", "status_code"],
            )

            self.http_request_duration_seconds = Histogram(
                "drovi_http_request_duration_seconds",
                "HTTP request duration in seconds",
                ["method", "endpoint"],
                buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            )

            # Intelligence extraction metrics
            self.extractions_total = Counter(
                "drovi_extractions_total",
                "Total intelligence extractions",
                ["organization_id", "source_type", "status"],
            )

            self.extraction_duration_seconds = Histogram(
                "drovi_extraction_duration_seconds",
                "Intelligence extraction duration in seconds",
                ["source_type"],
                buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0],
            )

            self.uios_extracted_total = Counter(
                "drovi_uios_extracted_total",
                "Total UIOs extracted",
                ["organization_id", "uio_type"],
            )

            self.entities_extracted_total = Counter(
                "drovi_entities_extracted_total",
                "Total entities extracted",
                ["organization_id", "entity_type"],
            )

            # Sync metrics
            self.sync_jobs_total = Counter(
                "drovi_sync_jobs_total",
                "Total sync jobs",
                ["connector_type", "status"],
            )

            self.sync_job_duration_seconds = Histogram(
                "drovi_sync_job_duration_seconds",
                "Sync job duration in seconds",
                ["connector_type"],
                buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 600.0],
            )

            self.records_synced_total = Counter(
                "drovi_records_synced_total",
                "Total records synced",
                ["connector_type"],
            )

            self.connector_last_success_timestamp_seconds = Gauge(
                "drovi_connector_last_success_timestamp_seconds",
                "Unix timestamp of last successful connector sync",
                ["connector_type"],
            )

            self.connector_last_error_timestamp_seconds = Gauge(
                "drovi_connector_last_error_timestamp_seconds",
                "Unix timestamp of last failed connector sync",
                ["connector_type"],
            )

            # Graph metrics
            self.graph_operations_total = Counter(
                "drovi_graph_operations_total",
                "Total graph operations",
                ["operation_type", "status"],
            )

            self.graph_operation_duration_seconds = Histogram(
                "drovi_graph_operation_duration_seconds",
                "Graph operation duration in seconds",
                ["operation_type"],
                buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
            )

            self.graph_nodes_total = Gauge(
                "drovi_graph_nodes_total",
                "Total nodes in graph",
                ["organization_id", "node_type"],
            )

            self.graph_edges_total = Gauge(
                "drovi_graph_edges_total",
                "Total edges in graph",
                ["organization_id", "edge_type"],
            )

            # LLM metrics
            self.llm_requests_total = Counter(
                "drovi_llm_requests_total",
                "Total LLM API requests",
                ["model", "status"],
            )

            self.llm_request_duration_seconds = Histogram(
                "drovi_llm_request_duration_seconds",
                "LLM request duration in seconds",
                ["model"],
                buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0],
            )

            self.llm_tokens_total = Counter(
                "drovi_llm_tokens_total",
                "Total LLM tokens used",
                ["model", "type"],  # type: input, output
            )

            # Search metrics
            self.search_requests_total = Counter(
                "drovi_search_requests_total",
                "Total search requests",
                ["search_type", "status"],
            )

            self.search_duration_seconds = Histogram(
                "drovi_search_duration_seconds",
                "Search request duration in seconds",
                ["search_type"],
                buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
            )

            self.search_results_count = Histogram(
                "drovi_search_results_count",
                "Number of search results returned",
                ["search_type"],
                buckets=[0, 1, 5, 10, 25, 50, 100],
            )

            # Event streaming metrics
            self.events_published_total = Counter(
                "drovi_events_published_total",
                "Total events published",
                ["event_type"],
            )

            self.active_event_subscriptions = Gauge(
                "drovi_active_event_subscriptions",
                "Number of active event subscriptions",
            )

            # Kafka consumer metrics
            self.kafka_consumer_lag = Gauge(
                "drovi_kafka_consumer_lag",
                "Kafka consumer lag by topic/partition",
                ["group_id", "topic", "partition"],
            )

            self.kafka_consumer_queue_depth = Gauge(
                "drovi_kafka_consumer_queue_depth",
                "Kafka consumer in-memory queue depth",
                ["group_id"],
            )

            self.kafka_consumer_paused = Gauge(
                "drovi_kafka_consumer_paused",
                "Kafka consumer paused state (1=paused)",
                ["group_id"],
            )

            self.kafka_consumer_last_poll_timestamp_seconds = Gauge(
                "drovi_kafka_consumer_last_poll_timestamp_seconds",
                "Unix timestamp of last Kafka poll",
                ["group_id"],
            )

            # Unified event model metrics
            self.uem_events_total = Counter(
                "drovi_uem_events_total",
                "Total unified events persisted",
                ["organization_id", "source_type", "event_type", "status"],
            )

            self.uem_persist_duration_seconds = Histogram(
                "drovi_uem_persist_duration_seconds",
                "Unified event persist duration in seconds",
                ["event_type"],
                buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
            )

            # Identity resolution metrics
            self.identity_resolution_attempts_total = Counter(
                "drovi_identity_resolution_attempts_total",
                "Total identity resolution attempts",
                ["organization_id", "source_type"],
            )

            self.identity_resolution_success_total = Counter(
                "drovi_identity_resolution_success_total",
                "Total identity resolution successes",
                ["organization_id", "source_type"],
            )

            self.transcript_ingest_duration_seconds = Histogram(
                "drovi_transcript_ingest_duration_seconds",
                "Transcript segment ingest duration in seconds",
                buckets=[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
            )

            # Memory/decay metrics
            self.memory_decay_runs_total = Counter(
                "drovi_memory_decay_runs_total",
                "Total memory decay computation runs",
                ["status"],
            )

            self.nodes_decayed_total = Counter(
                "drovi_nodes_decayed_total",
                "Total nodes that had decay applied",
            )

            self.nodes_archived_total = Counter(
                "drovi_nodes_archived_total",
                "Total nodes archived due to low relevance",
            )

            # System info
            self.build_info = Info(
                "drovi_build_info",
                "Build information",
            )

            self._enabled = True
            logger.info("Prometheus metrics initialized")

        except ImportError:
            logger.warning("prometheus_client not installed, metrics disabled")
            self._enabled = False

    @property
    def enabled(self) -> bool:
        """Check if metrics are enabled."""
        return self._enabled

    def set_build_info(self, version: str, commit: str | None = None) -> None:
        """Set build information."""
        if self._enabled:
            self.build_info.info({
                "version": version,
                "commit": commit or "unknown",
            })

    # Convenience methods for tracking
    def track_http_request(
        self,
        method: str,
        endpoint: str,
        status_code: int,
        duration: float,
    ) -> None:
        """Track an HTTP request."""
        if not self._enabled:
            return

        self.http_requests_total.labels(
            method=method,
            endpoint=endpoint,
            status_code=str(status_code),
        ).inc()

        self.http_request_duration_seconds.labels(
            method=method,
            endpoint=endpoint,
        ).observe(duration)

    def track_extraction(
        self,
        organization_id: str,
        source_type: str,
        status: str,
        duration: float,
        uio_counts: dict[str, int] | None = None,
        entity_counts: dict[str, int] | None = None,
    ) -> None:
        """Track an intelligence extraction."""
        if not self._enabled:
            return

        self.extractions_total.labels(
            organization_id=organization_id,
            source_type=source_type,
            status=status,
        ).inc()

        self.extraction_duration_seconds.labels(
            source_type=source_type,
        ).observe(duration)

        if uio_counts:
            for uio_type, count in uio_counts.items():
                self.uios_extracted_total.labels(
                    organization_id=organization_id,
                    uio_type=uio_type,
                ).inc(count)

    def track_uem_event(
        self,
        organization_id: str,
        source_type: str,
        event_type: str,
        status: str,
        duration: float,
        entity_counts: dict[str, int] | None = None,
    ) -> None:
        """Track unified event persistence."""
        if not self._enabled:
            return

        self.uem_events_total.labels(
            organization_id=organization_id,
            source_type=source_type,
            event_type=event_type,
            status=status,
        ).inc()

        self.uem_persist_duration_seconds.labels(
            event_type=event_type,
        ).observe(duration)

        if entity_counts:
            for entity_type, count in entity_counts.items():
                self.entities_extracted_total.labels(
                    organization_id=organization_id,
                    entity_type=entity_type,
                ).inc(count)

    def track_sync_job(
        self,
        connector_type: str,
        status: str,
        duration: float,
        records_synced: int = 0,
    ) -> None:
        """Track a sync job."""
        if not self._enabled:
            return

        self.sync_jobs_total.labels(
            connector_type=connector_type,
            status=status,
        ).inc()

        self.sync_job_duration_seconds.labels(
            connector_type=connector_type,
        ).observe(duration)

        if records_synced > 0:
            self.records_synced_total.labels(
                connector_type=connector_type,
            ).inc(records_synced)

        now = time.time()
        if status == "completed":
            self.connector_last_success_timestamp_seconds.labels(
                connector_type=connector_type,
            ).set(now)
        elif status == "failed":
            self.connector_last_error_timestamp_seconds.labels(
                connector_type=connector_type,
            ).set(now)

    def track_graph_operation(
        self,
        operation_type: str,
        status: str,
        duration: float,
    ) -> None:
        """Track a graph operation."""
        if not self._enabled:
            return

        self.graph_operations_total.labels(
            operation_type=operation_type,
            status=status,
        ).inc()

        self.graph_operation_duration_seconds.labels(
            operation_type=operation_type,
        ).observe(duration)

    def track_llm_request(
        self,
        model: str,
        status: str,
        duration: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Track an LLM request."""
        if not self._enabled:
            return

        self.llm_requests_total.labels(
            model=model,
            status=status,
        ).inc()

        self.llm_request_duration_seconds.labels(
            model=model,
        ).observe(duration)

        if input_tokens > 0:
            self.llm_tokens_total.labels(
                model=model,
                type="input",
            ).inc(input_tokens)

        if output_tokens > 0:
            self.llm_tokens_total.labels(
                model=model,
                type="output",
            ).inc(output_tokens)

    def track_search(
        self,
        search_type: str,
        status: str,
        duration: float,
        result_count: int = 0,
    ) -> None:
        """Track a search request."""
        if not self._enabled:
            return

        self.search_requests_total.labels(
            search_type=search_type,
            status=status,
        ).inc()

        self.search_duration_seconds.labels(
            search_type=search_type,
        ).observe(duration)

        self.search_results_count.labels(
            search_type=search_type,
        ).observe(result_count)

    def track_event_published(self, event_type: str) -> None:
        """Track an event being published."""
        if not self._enabled:
            return

        self.events_published_total.labels(
            event_type=event_type,
        ).inc()

    def set_kafka_consumer_lag(
        self,
        group_id: str,
        topic: str,
        partition: int,
        lag: float,
    ) -> None:
        """Set Kafka consumer lag gauge."""
        if not self._enabled:
            return

        self.kafka_consumer_lag.labels(
            group_id=group_id,
            topic=topic,
            partition=str(partition),
        ).set(max(lag, 0))

    def set_kafka_queue_depth(self, group_id: str, depth: int) -> None:
        """Set Kafka queue depth gauge."""
        if not self._enabled:
            return

        self.kafka_consumer_queue_depth.labels(
            group_id=group_id,
        ).set(max(depth, 0))

    def set_kafka_paused(self, group_id: str, paused: bool) -> None:
        """Set Kafka paused gauge."""
        if not self._enabled:
            return

        self.kafka_consumer_paused.labels(
            group_id=group_id,
        ).set(1 if paused else 0)

    def set_kafka_last_poll(self, group_id: str, timestamp: float) -> None:
        """Set Kafka last poll timestamp gauge."""
        if not self._enabled:
            return

        self.kafka_consumer_last_poll_timestamp_seconds.labels(
            group_id=group_id,
        ).set(timestamp)

    def set_graph_stats(
        self,
        organization_id: str,
        node_counts: dict[str, int],
        edge_counts: dict[str, int],
    ) -> None:
        """Set graph statistics gauges."""
        if not self._enabled:
            return

        for node_type, count in node_counts.items():
            self.graph_nodes_total.labels(
                organization_id=organization_id,
                node_type=node_type,
            ).set(count)

        for edge_type, count in edge_counts.items():
            self.graph_edges_total.labels(
                organization_id=organization_id,
                edge_type=edge_type,
            ).set(count)

    @contextmanager
    def time_operation(self, operation_type: str):
        """Context manager for timing operations."""
        start = time.perf_counter()
        status = "success"
        try:
            yield
        except Exception:
            status = "error"
            raise
        finally:
            duration = time.perf_counter() - start
            self.track_graph_operation(operation_type, status, duration)


def get_metrics() -> Metrics:
    """Get or create the singleton metrics instance."""
    global _metrics
    if _metrics is None:
        _metrics = Metrics()
    return _metrics


# Decorators for easy tracking
def track_request(endpoint: str):
    """Decorator to track HTTP request metrics."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            metrics = get_metrics()
            start = time.perf_counter()
            status_code = 500

            try:
                result = await func(*args, **kwargs)
                status_code = getattr(result, 'status_code', 200)
                return result
            except Exception as e:
                status_code = 500
                raise
            finally:
                duration = time.perf_counter() - start
                # Try to get method from request
                method = "UNKNOWN"
                if args and hasattr(args[0], 'method'):
                    method = args[0].method
                metrics.track_http_request(method, endpoint, status_code, duration)

        return wrapper
    return decorator


def track_extraction(source_type: str):
    """Decorator to track extraction metrics."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            metrics = get_metrics()
            start = time.perf_counter()
            status = "success"

            try:
                result = await func(*args, **kwargs)
                return result
            except Exception:
                status = "error"
                raise
            finally:
                duration = time.perf_counter() - start
                # Try to get org_id from kwargs or result
                org_id = kwargs.get('organization_id', 'unknown')
                metrics.track_extraction(org_id, source_type, status, duration)

        return wrapper
    return decorator


def track_sync(connector_type: str):
    """Decorator to track sync job metrics."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            metrics = get_metrics()
            start = time.perf_counter()
            status = "success"
            records = 0

            try:
                result = await func(*args, **kwargs)
                if isinstance(result, dict):
                    records = result.get('records_synced', 0)
                return result
            except Exception:
                status = "error"
                raise
            finally:
                duration = time.perf_counter() - start
                metrics.track_sync_job(connector_type, status, duration, records)

        return wrapper
    return decorator
