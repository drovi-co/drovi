from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import (
    BackfillDefaults,
    CircuitBreakerPolicy,
    ConnectorDefinition,
    HttpRetryPolicy,
)


CONNECTOR_TYPE = "commercial_premium"
DISPLAY_NAME = "Commercial Premium Feed"
SOURCE_TYPE = "commercial_api"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=True,
    default_rate_limit_per_minute=240,
    supports_concurrency=True,
    max_concurrent_streams=4,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=4,
    base_backoff_seconds=0.25,
    max_backoff_seconds=8.0,
)


CIRCUIT_BREAKER = CircuitBreakerPolicy(
    enabled=True,
    failure_threshold=3,
    reset_seconds=45.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=30, throttle_seconds=0.1)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="events",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="updated_at",
            primary_key=["id"],
            batch_size=200,
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
            "required": ["base_url"],
            "optional": [
                "endpoint",
                "result_path",
                "id_field",
                "cursor_field",
                "auth_mode",
                "api_key_header_name",
            ],
        },
        "credentials": {
            "per_tenant_required": True,
            "supported_keys": ["api_key", "access_token", "username", "password"],
        },
    },
)

