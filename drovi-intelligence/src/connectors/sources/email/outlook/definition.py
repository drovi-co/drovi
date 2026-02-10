from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "outlook"
DISPLAY_NAME = "Outlook"
SOURCE_TYPE = "email"

OAUTH_PROVIDER = "microsoft"
OAUTH_SCOPES = (
    "Mail.Read",
    "Mail.ReadBasic",
    "User.Read",
    "offline_access",
)


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=True,
    supports_real_time=True,
    default_rate_limit_per_minute=60,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=5,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=7, throttle_seconds=1.0)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="folders",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
            primary_key=["id"],
        ),
        StreamConfig(
            stream_name="messages",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="deltaLink",
            primary_key=["id"],
            cursor_type="opaque",
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

