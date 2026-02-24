from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import (
    BackfillDefaults,
    ConnectorDefinition,
    HttpRetryPolicy,
    RequiredSetting,
)


CONNECTOR_TYPE = "fred"
DISPLAY_NAME = "FRED"
SOURCE_TYPE = "macroeconomic_api"


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


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=4,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=3650, throttle_seconds=0.25)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="series_observations",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="observation_date",
            primary_key=["series_id", "date"],
            batch_size=200,
            cursor_type="iso_date",
        ),
    ]


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    required_settings=(
        RequiredSetting(settings_attr="fred_api_key", env_var="FRED_API_KEY"),
    ),
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
    ui_hints={
        "settings": {
            "required": ["series_ids"],
            "optional": ["observation_start", "observation_end"],
        }
    },
)

