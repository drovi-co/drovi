from __future__ import annotations

from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "bigquery"
DISPLAY_NAME = "Google BigQuery"
SOURCE_TYPE = "bigquery"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=60,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy()
BACKFILL_DEFAULTS = BackfillDefaults(window_days=30, throttle_seconds=0.5)


def default_streams():
    return []


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
    ui_hints={
        "streams": {"discovery": "dynamic"},
    },
)

