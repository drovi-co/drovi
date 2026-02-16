from __future__ import annotations

from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "mysql"
DISPLAY_NAME = "MySQL"
SOURCE_TYPE = "mysql"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=0,
    supports_concurrency=True,
    max_concurrent_streams=4,
    supports_schema_discovery=True,
)


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    capabilities=CAPABILITIES,
    http_retry=HttpRetryPolicy(),
    backfill_defaults=BackfillDefaults(window_days=30, throttle_seconds=0.0),
    default_streams_factory=lambda: [],
    ui_hints={"streams": {"discovery": "dynamic"}},
)

