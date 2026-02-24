from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import (
    BackfillDefaults,
    CircuitBreakerPolicy,
    ConnectorDefinition,
    HttpRetryPolicy,
)


CONNECTOR_TYPE = "rss_osint"
DISPLAY_NAME = "RSS / OSINT Feeds"
SOURCE_TYPE = "rss_feed"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=120,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=3,
    base_backoff_seconds=0.5,
    max_backoff_seconds=6.0,
)


CIRCUIT_BREAKER = CircuitBreakerPolicy(
    enabled=True,
    failure_threshold=4,
    reset_seconds=30.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=30, throttle_seconds=0.2)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="items",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="published_at",
            primary_key=["item_id"],
            batch_size=100,
            cursor_type="iso_datetime",
        ),
    ]


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    circuit_breaker=CIRCUIT_BREAKER,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
    ui_hints={
        "settings": {
            "required": ["feed_urls"],
            "optional": ["max_items_per_feed"],
        }
    },
)

