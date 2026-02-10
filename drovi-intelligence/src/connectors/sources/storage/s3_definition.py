from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "s3"
DISPLAY_NAME = "Amazon S3"
SOURCE_TYPE = "s3"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=60,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=False,
)


HTTP_RETRY = HttpRetryPolicy()
BACKFILL_DEFAULTS = BackfillDefaults(window_days=30, throttle_seconds=0.5)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="objects",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="last_modified",
            primary_key=["key"],
            cursor_type="iso_datetime",
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

