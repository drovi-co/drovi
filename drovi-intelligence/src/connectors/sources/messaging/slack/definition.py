from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "slack"
DISPLAY_NAME = "Slack"
SOURCE_TYPE = "slack"

OAUTH_PROVIDER = "slack"
OAUTH_SCOPES = (
    "channels:history",
    "channels:read",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "users:read",
    "users:read.email",
)


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=True,
    supports_real_time=True,
    default_rate_limit_per_minute=50,
    supports_concurrency=True,
    max_concurrent_streams=3,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=3,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=3, throttle_seconds=1.0)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="messages",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="ts",
            primary_key=["channel", "ts"],
            batch_size=100,
            cursor_type="float",
        ),
        StreamConfig(
            stream_name="channels",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
            primary_key=["id"],
            batch_size=100,
        ),
        StreamConfig(
            stream_name="users",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
            primary_key=["id"],
            batch_size=100,
        ),
    ]


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    oauth_provider=OAUTH_PROVIDER,
    oauth_scopes=OAUTH_SCOPES,
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
)

