from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _config(
    *,
    settings: dict | None = None,
    credentials: dict | None = None,
) -> ConnectorConfig:
    return ConnectorConfig(
        connection_id="conn_worldnews",
        organization_id="org_test",
        connector_type="worldnewsapi",
        name="worldnewsapi connection",
        auth=AuthConfig(auth_type=AuthType.NONE),
        provider_config={
            "settings": settings or {},
            "credentials": credentials or {},
        },
    )


def _response(
    *,
    status_code: int = 200,
    payload: dict | None = None,
    text: str | None = None,
    headers: dict[str, str] | None = None,
) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.headers = headers or {}
    response.json.return_value = payload or {}
    response.text = text or ""
    response.raise_for_status.return_value = None
    return response


async def test_worldnewsapi_check_connection_requires_api_key() -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config()
    ok, error = await connector.check_connection(config)

    assert ok is False
    assert "Missing World News API key" in (error or "")


async def test_worldnewsapi_check_connection_handles_401() -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config(credentials={"api_key": "test_key"})

    with patch(
        "src.connectors.sources.world.worldnewsapi.connector_request",
        new=AsyncMock(return_value=_response(status_code=401, payload={"status": "error"})),
    ):
        ok, error = await connector.check_connection(config)

    assert ok is False
    assert "authentication failed" in (error or "").lower()


async def test_worldnewsapi_endpoint_complete_ingestion_dedupe_and_checkpoint() -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config(
        settings={
            "search_queries": ["semiconductor supply chain"],
            "page_size": 50,
            "max_pages_per_query": 1,
            "top_news_source_countries": ["us"],
            "top_news_languages": ["en"],
            "front_page_source_countries": ["us"],
            "front_page_languages": ["en"],
            "retrieve_ids": ["d1"],
            "extract_urls": ["https://example.com/e"],
            "extract_links_urls": ["https://example.com/e"],
            "feed_rss_urls": ["https://example.com"],
            "source_search_terms": ["tech"],
            "source_suggestions": [{"url": "https://example.com", "name": "Example News"}],
        },
        credentials={"api_key": "test_key"},
    )
    stream = (await connector.discover_streams(config))[0]

    headers = {"X-API-Quota-Request": "3", "X-API-Quota-Left": "997"}
    search_payload = {
        "news": [
            {
                "id": "a1",
                "title": "A1",
                "url": "https://example.com/a?utm_source=test",
                "publish_date": "2026-02-20T10:00:00Z",
                "text": "x" * 300,
                "source_country": "us",
                "language": "en",
            },
            {
                "id": "b1",
                "title": "B1",
                "url": "https://example.com/b",
                "publish_date": "2026-02-20T11:00:00Z",
                "text": "x" * 300,
                "source_country": "us",
                "language": "en",
            },
        ]
    }
    top_payload = {
        "top_news": [
            {
                "cluster_id": "cluster_1",
                "news": [
                    {
                        "id": "a1",
                        "title": "A1 duplicate",
                        "url": "https://example.com/a",
                        "publish_date": "2026-02-20T10:00:00Z",
                        "text": "x" * 300,
                        "source_country": "us",
                        "language": "en",
                    }
                ],
            }
        ]
    }
    front_payload = {
        "front_pages": [
            {
                "name": "Example Front",
                "news": [
                    {
                        "id": "c1",
                        "title": "C1",
                        "url": "https://example.com/c",
                        "publish_date": "2026-02-20T12:00:00Z",
                        "text": "x" * 300,
                    }
                ],
            }
        ]
    }
    retrieve_payload = {
        "news": [
            {
                "id": "d1",
                "title": "D1",
                "url": "https://example.com/d",
                "publish_date": "2026-02-21T08:00:00Z",
                "text": "x" * 300,
            }
        ]
    }
    extract_payload = {
        "news": [
            {
                "id": "e1",
                "title": "E1",
                "url": "https://example.com/e",
                "publish_date": "2026-02-21T09:00:00Z",
                "text": "x" * 300,
            }
        ]
    }
    extract_links_payload = {
        "news_links": [
            {
                "id": "e1",
                "url": "https://example.com/e",
                "publish_date": "2026-02-21T09:00:00Z",
            }
        ]
    }
    rss_payload = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item>
      <title>F1</title>
      <link>https://example.com/f</link>
      <description>F1 Summary</description>
      <pubDate>Sat, 21 Feb 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>"""
    source_search_payload = {
        "news_sources": [
            {"id": "src_1", "name": "Source 1", "url": "https://source.example.com"}
        ]
    }
    suggest_payload = {"status": "ok"}

    mock_request = AsyncMock(
        side_effect=[
            _response(payload=search_payload, headers=headers),
            _response(payload=top_payload, headers=headers),
            _response(status_code=404, payload={"status": "not_found"}, headers=headers),
            _response(payload=front_payload, headers=headers),
            _response(payload=retrieve_payload, headers=headers),
            _response(payload=extract_payload, headers=headers),
            _response(payload=extract_links_payload, headers=headers),
            _response(text=rss_payload, payload={}, headers=headers),
            _response(payload=source_search_payload, headers=headers),
            _response(payload=suggest_payload, headers=headers),
        ]
    )

    with patch(
        "src.connectors.sources.world.worldnewsapi.connector_request",
        new=mock_request,
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) >= 1
    all_records = [record for batch in batches for record in batch.records]
    assert len(all_records) == 8

    endpoints_hit = [str(call.kwargs.get("url")) for call in mock_request.await_args_list]
    assert any(url.endswith("/front-pages") for url in endpoints_hit)
    assert any(url.endswith("/retrieve-front-page") for url in endpoints_hit)

    article_record = next(record for record in all_records if record.data.get("article_id") == "a1")
    assert article_record.data["url"] == "https://example.com/a"
    assert article_record.data["quality"]["reliability_score"] > 0.0
    assert article_record.data["endpoint"] in {"search-news", "top-news"}

    last_batch = batches[-1]
    assert isinstance(last_batch.next_cursor, dict)
    assert "offset_by_shard" in last_batch.next_cursor
    assert "last_publish_date" in last_batch.next_cursor


async def test_worldnewsapi_dynamic_backoff_on_low_quota_header() -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config(
        settings={
            "search_queries": ["macro"],
            "page_size": 25,
            "max_pages_per_query": 1,
            "top_news_enabled": False,
            "front_pages_enabled": False,
            "retrieve_news_enabled": False,
            "extract_news_enabled": False,
            "extract_news_links_enabled": False,
            "feed_rss_enabled": False,
            "search_news_sources_enabled": False,
            "suggest_news_source_enabled": False,
            "quota_low_watermark": 5,
            "max_quota_backoff_seconds": 1,
        },
        credentials={"api_key": "test_key"},
    )
    stream = (await connector.discover_streams(config))[0]

    mock_request = AsyncMock(
        return_value=_response(
            payload={"news": []},
            headers={"X-API-Quota-Left": "3", "X-API-Quota-Request": "1"},
        )
    )

    with (
        patch("src.connectors.sources.world.worldnewsapi.connector_request", new=mock_request),
        patch("src.connectors.sources.world.worldnewsapi.asyncio.sleep", new=AsyncMock()) as mock_sleep,
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert batches == []
    assert mock_sleep.await_count == 1
    assert float(mock_sleep.await_args.args[0]) > 0.0


@pytest.mark.parametrize(
    ("status_code", "expected_error"),
    [
        (402, "quota exhausted"),
        (429, "rate limited"),
        (503, "server error"),
    ],
)
async def test_worldnewsapi_read_stream_error_scenarios(status_code: int, expected_error: str) -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config(
        settings={
            "search_queries": ["critical"],
            "top_news_enabled": False,
            "front_pages_enabled": False,
            "retrieve_news_enabled": False,
            "extract_news_enabled": False,
            "extract_news_links_enabled": False,
            "feed_rss_enabled": False,
            "search_news_sources_enabled": False,
            "suggest_news_source_enabled": False,
        },
        credentials={"api_key": "test_key"},
    )
    stream = (await connector.discover_streams(config))[0]

    with patch(
        "src.connectors.sources.world.worldnewsapi.connector_request",
        new=AsyncMock(return_value=_response(status_code=status_code, payload={"status": "error"})),
    ):
        with pytest.raises(RuntimeError, match=expected_error):
            _ = [batch async for batch in connector.read_stream(config, stream, None)]


async def test_worldnewsapi_query_planner_from_exposure_and_hypothesis() -> None:
    from src.connectors.sources.world.worldnewsapi import WorldNewsApiConnector

    connector = WorldNewsApiConnector()
    config = _config(
        settings={
            "entity_exposure": ["Taiwan", "semiconductor"],
            "hypothesis_context": ["export controls", "supply chain disruption"],
            "max_query_shards": 3,
            "page_size": 100,
            "max_pages_per_query": 1,
            "top_news_enabled": False,
            "front_pages_enabled": False,
            "retrieve_news_enabled": False,
            "extract_news_enabled": False,
            "extract_news_links_enabled": False,
            "feed_rss_enabled": False,
            "search_news_sources_enabled": False,
            "suggest_news_source_enabled": False,
        },
        credentials={"api_key": "test_key"},
    )
    stream = (await connector.discover_streams(config))[0]

    mock_request = AsyncMock(
        side_effect=[
            _response(
                payload={
                    "news": [
                        {
                            "id": "q1",
                            "title": "Q1",
                            "url": "https://example.com/q1",
                            "publish_date": "2026-02-22T00:00:00Z",
                        }
                    ]
                },
                headers={"X-API-Quota-Request": "1", "X-API-Quota-Left": "900"},
            ),
            _response(
                payload={
                    "news": [
                        {
                            "id": "q2",
                            "title": "Q2",
                            "url": "https://example.com/q2",
                            "publish_date": "2026-02-22T00:01:00Z",
                        }
                    ]
                },
                headers={"X-API-Quota-Request": "1", "X-API-Quota-Left": "899"},
            ),
            _response(
                payload={
                    "news": [
                        {
                            "id": "q3",
                            "title": "Q3",
                            "url": "https://example.com/q3",
                            "publish_date": "2026-02-22T00:02:00Z",
                        }
                    ]
                },
                headers={"X-API-Quota-Request": "1", "X-API-Quota-Left": "898"},
            ),
        ]
    )

    with patch(
        "src.connectors.sources.world.worldnewsapi.connector_request",
        new=mock_request,
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    all_records = [record for batch in batches for record in batch.records]
    assert len(all_records) == 3
    query_texts = [
        str(call.kwargs.get("params", {}).get("text"))
        for call in mock_request.await_args_list
    ]
    assert len(query_texts) == 3
    assert any("Taiwan" in query for query in query_texts)
    assert any("semiconductor" in query for query in query_texts)

    assert batches
    last_cursor = batches[-1].next_cursor or {}
    assert "offset_by_shard" in last_cursor
    assert len(last_cursor["offset_by_shard"]) == 3
