from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "sec_edgar"
DISPLAY_NAME = "SEC EDGAR"
SOURCE_TYPE = "regulatory_api"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=10,
    supports_concurrency=True,
    max_concurrent_streams=1,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=4,
    base_backoff_seconds=1.0,
    max_backoff_seconds=16.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=365, throttle_seconds=1.0)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="filings",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="acceptance_datetime",
            primary_key=["cik", "accession_number"],
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
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
    ui_hints={
        "settings": {
            "required": ["ciks"],
            "optional": ["user_agent"],
        }
    },
)

