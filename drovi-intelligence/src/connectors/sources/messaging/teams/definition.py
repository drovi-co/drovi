from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "teams"
DISPLAY_NAME = "Microsoft Teams"
SOURCE_TYPE = "teams"

OAUTH_PROVIDER = "microsoft"
OAUTH_SCOPES = (
    "ChannelMessage.Read.All",
    "Chat.Read",
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
    max_concurrent_streams=3,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=5,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=3, throttle_seconds=1.0)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(stream_name="teams", enabled=True, sync_mode=SyncMode.FULL_REFRESH, primary_key=["id"]),
        StreamConfig(stream_name="channels", enabled=True, sync_mode=SyncMode.FULL_REFRESH, primary_key=["id"]),
        StreamConfig(
            stream_name="channel_messages",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastModifiedDateTime",
            primary_key=["id"],
            cursor_type="iso_datetime",
        ),
        StreamConfig(
            stream_name="chats",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastUpdatedDateTime",
            primary_key=["id"],
            cursor_type="iso_datetime",
        ),
        StreamConfig(
            stream_name="chat_messages",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastModifiedDateTime",
            primary_key=["id"],
            cursor_type="iso_datetime",
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

