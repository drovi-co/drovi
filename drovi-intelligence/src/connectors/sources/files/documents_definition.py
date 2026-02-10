from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "documents"
DISPLAY_NAME = "Documents"
SOURCE_TYPE = "documents"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=False,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=60,
    supports_concurrency=True,
    max_concurrent_streams=1,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=5,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=30, throttle_seconds=0.5)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="documents",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
            primary_key=["id"],
        ),
    ]


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
)

