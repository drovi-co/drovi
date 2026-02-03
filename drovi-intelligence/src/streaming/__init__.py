"""
Kafka Streaming Infrastructure

Real-time event streaming for the Drovi Intelligence Platform.
Provides sub-second latency for graph updates and event propagation.

Components:
- KafkaProducer: Produce events to Kafka topics
- KafkaConsumer: Consume and process events
- FalkorDBSink: Direct streaming writes to FalkorDB
- StreamProcessor: Orchestrates the full streaming pipeline

Topics:
- raw.connector.events: Raw webhook/connector events
- normalized.records: Canonical normalized records
- intelligence.pipeline.input: Pipeline input events
- graph.changes: Graph change notifications for real-time subscriptions

Usage:
    # In main.py lifespan:
    from src.streaming import init_streaming, shutdown_streaming

    async with lifespan(app):
        await init_streaming()  # Starts Kafka if enabled
        yield
        await shutdown_streaming()  # Graceful shutdown
"""

from .kafka_producer import (
    DroviKafkaProducer,
    get_kafka_producer,
    close_kafka_producer,
)
from .kafka_consumer import (
    DroviKafkaConsumer,
    get_kafka_consumer,
    close_kafka_consumer,
)
from .falkordb_sink import (
    FalkorDBStreamSink,
    get_falkordb_sink,
    close_falkordb_sink,
    StreamProcessor,
)

# Global stream processor instance
_stream_processor: StreamProcessor | None = None


async def init_streaming() -> bool:
    """
    Initialize the streaming infrastructure.

    Only starts if KAFKA_ENABLED=true in environment.
    Gracefully returns False if Kafka is disabled or unavailable.

    Returns:
        True if streaming started, False otherwise
    """
    global _stream_processor

    from src.config import get_settings
    import structlog

    logger = structlog.get_logger()
    settings = get_settings()

    if not settings.kafka_enabled:
        logger.info("Kafka streaming disabled (KAFKA_ENABLED=false)")
        return False
    if not settings.kafka_run_processor_in_api:
        logger.info(
            "Kafka stream processor disabled for API (KAFKA_RUN_PROCESSOR_IN_API=false)"
        )
        return False

    try:
        _stream_processor = StreamProcessor()
        await _stream_processor.start()
        logger.info(
            "Kafka streaming initialized",
            bootstrap_servers=settings.kafka_bootstrap_servers,
            topics=[
                settings.kafka_topic_raw_events,
                settings.kafka_topic_normalized_records,
                settings.kafka_topic_pipeline_input,
                settings.kafka_topic_graph_changes,
            ],
        )
        return True
    except Exception as e:
        logger.warning(
            "Kafka streaming failed to start, continuing without streaming",
            error=str(e),
        )
        _stream_processor = None
        return False


async def shutdown_streaming() -> None:
    """Shutdown the streaming infrastructure gracefully."""
    global _stream_processor

    import structlog
    logger = structlog.get_logger()

    if _stream_processor:
        try:
            await _stream_processor.stop()
            logger.info("Kafka streaming shutdown complete")
        except Exception as e:
            logger.warning("Error during streaming shutdown", error=str(e))
        finally:
            _stream_processor = None

    # Close all components
    await close_kafka_producer()
    await close_kafka_consumer()
    await close_falkordb_sink()


def is_streaming_enabled() -> bool:
    """Check if streaming is currently active."""
    return _stream_processor is not None


__all__ = [
    # Producer
    "DroviKafkaProducer",
    "get_kafka_producer",
    "close_kafka_producer",
    # Consumer
    "DroviKafkaConsumer",
    "get_kafka_consumer",
    "close_kafka_consumer",
    # Sink
    "FalkorDBStreamSink",
    "get_falkordb_sink",
    "close_falkordb_sink",
    # Stream Processor
    "StreamProcessor",
    # Lifecycle
    "init_streaming",
    "shutdown_streaming",
    "is_streaming_enabled",
]
