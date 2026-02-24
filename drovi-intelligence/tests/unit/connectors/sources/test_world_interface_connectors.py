from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig
from src.connectors.base.state import ConnectorState

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _config(
    connector_type: str,
    *,
    settings: dict | None = None,
    credentials: dict | None = None,
) -> ConnectorConfig:
    return ConnectorConfig(
        connection_id=f"conn_{connector_type}",
        organization_id="org_test",
        connector_type=connector_type,
        name=f"{connector_type} connection",
        auth=AuthConfig(auth_type=AuthType.NONE),
        provider_config={
            "settings": settings or {},
            "credentials": credentials or {},
        },
    )


def _json_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.headers = {}
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


def _text_response(text: str) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.headers = {}
    response.text = text
    response.raise_for_status.return_value = None
    return response


async def test_commercial_premium_requires_tenant_credentials() -> None:
    from src.connectors.sources.world.commercial_premium import CommercialPremiumConnector

    connector = CommercialPremiumConnector()
    config = _config(
        "commercial_premium",
        settings={"base_url": "https://api.premium.test", "endpoint": "/events"},
    )
    ok, error = await connector.check_connection(config)
    assert ok is False
    assert "api_key" in (error or "")


async def test_commercial_premium_reads_events_with_api_key_header() -> None:
    from src.connectors.sources.world.commercial_premium import CommercialPremiumConnector

    connector = CommercialPremiumConnector()
    config = _config(
        "commercial_premium",
        settings={
            "base_url": "https://api.premium.test",
            "endpoint": "/events",
            "result_path": "results",
            "cursor_field": "updated_at",
            "id_field": "id",
            "max_pages": 1,
            "auth_mode": "api_key_header",
            "api_key_header_name": "X-API-Key",
        },
        credentials={"api_key": "tenant_api_key_123"},
    )
    stream = (await connector.discover_streams(config))[0]

    payload = {
        "results": [
            {"id": "evt_1", "updated_at": "2026-02-22T08:00:00+00:00", "headline": "a"},
            {"id": "evt_2", "updated_at": "2026-02-22T09:00:00+00:00", "headline": "b"},
        ]
    }

    mock_request = AsyncMock(return_value=_json_response(payload))
    with patch(
        "src.connectors.sources.world.commercial_premium.connector_request",
        new=mock_request,
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 2
    assert batches[0].next_cursor == {"updated_at": "2026-02-22T09:00:00+00:00"}
    first_call = mock_request.await_args_list[0]
    headers = first_call.kwargs.get("headers") or {}
    assert headers.get("X-API-Key") == "tenant_api_key_123"


async def test_rss_osint_parses_and_filters_incremental_items() -> None:
    from src.connectors.sources.world.rss_osint import RssOsintConnector

    connector = RssOsintConnector()
    config = _config(
        "rss_osint",
        settings={
            "feed_urls": ["https://feed.example.com/rss.xml"],
            "max_items_per_feed": 100,
        },
    )
    stream = (await connector.discover_streams(config))[0]

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <guid>item-old</guid>
      <title>Old item</title>
      <link>https://example.com/old</link>
      <description>Old desc</description>
      <pubDate>Fri, 21 Feb 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>item-new</guid>
      <title>New item</title>
      <link>https://example.com/new</link>
      <description>New desc</description>
      <pubDate>Sat, 22 Feb 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

    state = ConnectorState(connection_id=config.connection_id, connector_type="rss_osint")
    state.update_cursor("items", {"published_at": "2026-02-22T00:00:00+00:00"})

    with patch(
        "src.connectors.sources.world.rss_osint.connector_request",
        new=AsyncMock(return_value=_text_response(xml)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, state)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    record = batches[0].records[0]
    assert record.data["title"] == "New item"
    assert record.data["source_type"] == "rss"

