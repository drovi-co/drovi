from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import BackfillDefaults, ConnectorDefinition, HttpRetryPolicy


CONNECTOR_TYPE = "hubspot"
DISPLAY_NAME = "HubSpot"
SOURCE_TYPE = "crm"

OAUTH_PROVIDER = "hubspot"
OAUTH_SCOPES = (
    "crm.objects.contacts.read",
    "crm.objects.companies.read",
    "crm.objects.deals.read",
)


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=100,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=5,
    base_backoff_seconds=0.5,
    max_backoff_seconds=8.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=14, throttle_seconds=2.0)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="contacts",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastmodifieddate",
            primary_key=["id"],
            cursor_type="int",
        ),
        StreamConfig(
            stream_name="companies",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastmodifieddate",
            primary_key=["id"],
            cursor_type="int",
        ),
        StreamConfig(
            stream_name="deals",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastmodifieddate",
            primary_key=["id"],
            cursor_type="int",
        ),
        StreamConfig(
            stream_name="engagements",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="lastUpdated",
            primary_key=["id"],
            cursor_type="int",
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

