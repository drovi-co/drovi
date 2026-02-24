from __future__ import annotations

from src.connectors.base.config import StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorCapabilities
from src.connectors.definitions.models import (
    BackfillDefaults,
    CircuitBreakerPolicy,
    ConnectorDefinition,
    HttpRetryPolicy,
    RequiredSetting,
)


CONNECTOR_TYPE = "worldnewsapi"
DISPLAY_NAME = "World News API"
SOURCE_TYPE = "news_api"


CAPABILITIES = ConnectorCapabilities(
    supports_incremental=True,
    supports_full_refresh=True,
    supports_backfill=True,
    supports_webhooks=False,
    supports_real_time=False,
    default_rate_limit_per_minute=120,
    supports_concurrency=True,
    max_concurrent_streams=2,
    supports_schema_discovery=True,
)


HTTP_RETRY = HttpRetryPolicy(
    max_attempts=5,
    base_backoff_seconds=0.5,
    max_backoff_seconds=16.0,
)


CIRCUIT_BREAKER = CircuitBreakerPolicy(
    enabled=True,
    failure_threshold=4,
    reset_seconds=45.0,
)


BACKFILL_DEFAULTS = BackfillDefaults(window_days=90, throttle_seconds=0.25)


def default_streams() -> list[StreamConfig]:
    return [
        StreamConfig(
            stream_name="events",
            enabled=True,
            sync_mode=SyncMode.INCREMENTAL,
            cursor_field="last_publish_date",
            primary_key=["dedupe_key"],
            batch_size=100,
            cursor_type="iso_datetime",
        ),
    ]


CONNECTOR_DEFINITION = ConnectorDefinition(
    connector_type=CONNECTOR_TYPE,
    display_name=DISPLAY_NAME,
    source_type=SOURCE_TYPE,
    required_settings=(
        RequiredSetting(settings_attr="world_news_api_key", env_var="WORLD_NEWS_API_KEY"),
    ),
    capabilities=CAPABILITIES,
    http_retry=HTTP_RETRY,
    circuit_breaker=CIRCUIT_BREAKER,
    backfill_defaults=BACKFILL_DEFAULTS,
    default_streams_factory=default_streams,
    ui_hints={
        "settings": {
            "required": [],
            "optional": [
                "search_queries",
                "entity_exposure",
                "hypothesis_context",
                "source_countries",
                "languages",
                "categories",
                "max_pages_per_query",
                "page_size",
                "max_records",
                "extract_urls",
                "extract_links_urls",
                "feed_rss_urls",
                "retrieve_ids",
                "source_search_terms",
                "source_suggestions",
            ],
        },
        "credentials": {
            "per_tenant_required": False,
            "supported_keys": ["api_key"],
            "fallback_env": "WORLD_NEWS_API_KEY",
        },
    },
)
