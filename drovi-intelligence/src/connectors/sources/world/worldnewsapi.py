"""
World News API connector.

Implements endpoint-complete ingestion adapters for:
- /search-news
- /top-news
- /front-pages (with /retrieve-front-page fallback)
- /retrieve-news
- /extract-news
- /extract-news-links
- /feed.rss
- /search-news-sources
- /suggest-news-source
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from xml.etree import ElementTree

import httpx

from src.config import get_settings
from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.cursors import compare_cursor_values
from src.connectors.http_client import connector_request
from src.connectors.sources.world.worldnewsapi_definition import CAPABILITIES, default_streams

try:  # pragma: no cover
    from prometheus_client import Counter, Gauge, Histogram

    _ingest_latency_seconds = Histogram(
        "drovi_worldnews_ingest_latency_seconds",
        "World News API ingest latency in seconds by endpoint and status.",
        ["endpoint", "status"],
    )
    _quota_burn_points_total = Counter(
        "drovi_worldnews_quota_burn_points_total",
        "World News API quota points consumed.",
        ["endpoint"],
    )
    _duplicate_collapsed_total = Counter(
        "drovi_worldnews_duplicate_collapsed_total",
        "World News API duplicate records collapsed.",
        ["endpoint_family"],
    )
    _publish_total = Counter(
        "drovi_worldnews_publish_total",
        "World News API publish attempts by status.",
        ["status"],
    )
    _duplicate_collapse_ratio = Gauge(
        "drovi_worldnews_duplicate_collapse_ratio",
        "Ratio of duplicate records collapsed.",
        ["connector_type"],
    )
    _publish_success_ratio = Gauge(
        "drovi_worldnews_publish_success_ratio",
        "Ratio of publish attempts resulting in emitted records.",
        ["connector_type"],
    )
    _latency_slo_violations_total = Counter(
        "drovi_worldnews_latency_slo_violations_total",
        "World News API requests exceeding latency SLO.",
        ["endpoint"],
    )
except Exception:  # pragma: no cover
    _ingest_latency_seconds = None
    _quota_burn_points_total = None
    _duplicate_collapsed_total = None
    _publish_total = None
    _duplicate_collapse_ratio = None
    _publish_success_ratio = None
    _latency_slo_violations_total = None


class WorldNewsApiConnector(BaseConnector):
    """Connector for World News API."""

    connector_type = "worldnewsapi"
    capabilities = CAPABILITIES

    BASE_URL = "https://api.worldnewsapi.com"
    API_KEY_HEADER = "x-api-key"

    SEARCH_NEWS_PATH = "/search-news"
    TOP_NEWS_PATH = "/top-news"
    FRONT_PAGE_PATHS = ("/front-pages", "/retrieve-front-page")
    RETRIEVE_NEWS_PATH = "/retrieve-news"
    EXTRACT_NEWS_PATH = "/extract-news"
    EXTRACT_NEWS_LINKS_PATH = "/extract-news-links"
    FEED_RSS_PATH = "/feed.rss"
    SEARCH_NEWS_SOURCES_PATH = "/search-news-sources"
    SUGGEST_NEWS_SOURCE_PATH = "/suggest-news-source"

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        api_key = self._resolve_api_key(config)
        if not api_key:
            return (
                False,
                "Missing World News API key (provider_config.credentials.api_key or WORLD_NEWS_API_KEY)",
            )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                await self._request_json(
                    client=client,
                    config=config,
                    path=self.SEARCH_NEWS_PATH,
                    operation="check_connection",
                    params={"text": "global markets", "number": 1, "sort": "publish-time"},
                )
            return True, None
        except Exception as exc:
            return False, f"World News API connection failed: {exc}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        return default_streams()

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        if stream.stream_name != "events":
            raise ValueError(f"Unknown stream for worldnewsapi: {stream.stream_name}")

        api_key = self._resolve_api_key(config)
        if not api_key:
            raise ValueError("Missing World News API key")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = self._normalize_datetime(cursor.get("last_publish_date"))
        offset_by_shard = self._coerce_int_map(cursor.get("offset_by_shard"))

        batch_size = max(1, min(int(stream.batch_size or 100), 500))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None
        request_timeout = float(config.get_setting("request_timeout_seconds") or 45.0)

        emitted = 0
        candidates_seen = 0
        duplicates_collapsed = 0
        publish_failures = 0
        newest_publish: str | None = cursor_cutoff or None
        batch = self.create_batch(stream.stream_name, config.connection_id)
        seen_dedupe_keys: set[str] = set()

        async with httpx.AsyncClient(timeout=request_timeout) as client:
            async for candidate, context in self._iter_candidates(
                client=client,
                config=config,
                stream=stream,
                cursor_cutoff=cursor_cutoff,
                offset_by_shard=offset_by_shard,
            ):
                candidates_seen += 1
                normalized = self._normalize_candidate(candidate, context, config)
                dedupe_key = str(normalized.get("dedupe_key") or "")
                if dedupe_key and dedupe_key in seen_dedupe_keys:
                    duplicates_collapsed += 1
                    self._metric_inc_duplicate_collapsed(str(context.get("endpoint_family") or "unknown"))
                    continue
                if dedupe_key:
                    seen_dedupe_keys.add(dedupe_key)

                publish_date = self._normalize_datetime(normalized.get("publish_date"))
                if (
                    stream.sync_mode == SyncMode.INCREMENTAL
                    and cursor_cutoff
                    and publish_date
                ):
                    compare = compare_cursor_values(cursor_cutoff, publish_date)
                    if compare.comparable and not compare.is_forward_or_equal:
                        continue
                    if compare.comparable and str(publish_date) == str(cursor_cutoff):
                        continue

                record_id = str(
                    normalized.get("article_id")
                    or normalized.get("source_id")
                    or normalized.get("suggestion_id")
                    or dedupe_key
                    or f"worldnews:{emitted + candidates_seen}"
                )
                cursor_value = publish_date or normalized.get("observed_at")
                try:
                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=normalized,
                        cursor_value=cursor_value,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1
                    self._metric_inc_publish("emitted")
                except Exception:
                    publish_failures += 1
                    self._metric_inc_publish("failed")
                    continue

                if publish_date is not None:
                    if newest_publish is None:
                        newest_publish = publish_date
                    else:
                        compare_newest = compare_cursor_values(newest_publish, publish_date)
                        if (not compare_newest.comparable) or compare_newest.is_forward_or_equal:
                            newest_publish = publish_date

                if len(batch.records) >= batch_size:
                    batch.complete(
                        next_cursor=self._build_next_cursor(newest_publish, offset_by_shard),
                        has_more=True,
                    )
                    yield batch
                    batch = self.create_batch(stream.stream_name, config.connection_id)

                if max_records_int is not None and emitted >= max_records_int:
                    break

        if batch.records:
            batch.complete(
                next_cursor=self._build_next_cursor(newest_publish, offset_by_shard),
                has_more=False,
            )
            yield batch

        self._metric_set_duplicate_ratio(duplicates_collapsed, candidates_seen)
        self._metric_set_publish_success_ratio(emitted, publish_failures)

    async def _iter_candidates(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        stream: StreamConfig,
        cursor_cutoff: str | None,
        offset_by_shard: dict[str, int],
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        if self._is_enabled(config, "search_news_enabled", default=True):
            async for item, context in self._iter_search_news(
                client=client,
                config=config,
                stream=stream,
                cursor_cutoff=cursor_cutoff,
                offset_by_shard=offset_by_shard,
            ):
                yield item, context

        if self._is_enabled(config, "top_news_enabled", default=True):
            async for item, context in self._iter_top_news(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "front_pages_enabled", default=True):
            async for item, context in self._iter_front_pages(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "retrieve_news_enabled", default=True):
            async for item, context in self._iter_retrieve_news(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "extract_news_enabled", default=True):
            async for item, context in self._iter_extract_news(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "extract_news_links_enabled", default=True):
            async for item, context in self._iter_extract_news_links(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "feed_rss_enabled", default=True):
            async for item, context in self._iter_feed_rss(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "search_news_sources_enabled", default=True):
            async for item, context in self._iter_search_news_sources(client=client, config=config):
                yield item, context

        if self._is_enabled(config, "suggest_news_source_enabled", default=True):
            async for item, context in self._iter_suggest_news_source(client=client, config=config):
                yield item, context

    async def _iter_search_news(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        stream: StreamConfig,
        cursor_cutoff: str | None,
        offset_by_shard: dict[str, int],
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        query_plan = self._build_query_plan(config)
        if not query_plan:
            return

        page_size = max(1, min(int(config.get_setting("page_size") or 50), 100))
        max_pages_per_query = max(1, min(int(config.get_setting("max_pages_per_query") or 3), 500))

        for query in query_plan:
            shard = self._query_shard(query)
            offset = max(0, int(offset_by_shard.get(shard) or 0))
            pages_processed = 0

            while pages_processed < max_pages_per_query:
                params = self._build_search_news_params(
                    config=config,
                    query=query,
                    offset=offset,
                    page_size=page_size,
                    stream=stream,
                    cursor_cutoff=cursor_cutoff,
                )
                payload, response_meta = await self._request_json(
                    client=client,
                    config=config,
                    path=self.SEARCH_NEWS_PATH,
                    operation="search_news",
                    params=params,
                )

                items = self._extract_news_items(payload)
                if not items:
                    offset_by_shard[shard] = 0
                    break

                for item in items:
                    context = {
                        "endpoint": "search-news",
                        "endpoint_family": "news",
                        "query": query,
                        "query_shard": shard,
                        "offset": offset,
                        **response_meta,
                    }
                    yield item, context

                if len(items) < page_size:
                    offset_by_shard[shard] = 0
                    break

                offset += page_size
                pages_processed += 1
                offset_by_shard[shard] = offset

    async def _iter_top_news(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        countries = self._coerce_string_list(
            config.get_setting("top_news_source_countries")
            or config.get_setting("source_countries")
        ) or [None]
        languages = self._coerce_string_list(
            config.get_setting("top_news_languages")
            or config.get_setting("languages")
        ) or [None]

        max_calls = max(1, min(int(config.get_setting("top_news_max_calls") or 10), 200))
        calls = 0
        for country in countries:
            for language in languages:
                if calls >= max_calls:
                    return
                params: dict[str, Any] = {}
                if country:
                    params["source-country"] = country
                if language:
                    params["language"] = language
                date_value = config.get_setting("top_news_date")
                if date_value:
                    params["date"] = str(date_value)

                params.update(self._coerce_dict(config.get_setting("top_news_params")))
                payload, response_meta = await self._request_json(
                    client=client,
                    config=config,
                    path=self.TOP_NEWS_PATH,
                    operation="top_news",
                    params=params,
                )
                clusters = payload.get("top_news") or payload.get("top-news") or payload.get("news") or []
                if not isinstance(clusters, list):
                    clusters = []

                for cluster in clusters:
                    if not isinstance(cluster, dict):
                        continue
                    cluster_news = cluster.get("news")
                    cluster_id = (
                        cluster.get("id")
                        or cluster.get("cluster_id")
                        or cluster.get("cluster-id")
                    )
                    if isinstance(cluster_news, list):
                        for item in cluster_news:
                            if not isinstance(item, dict):
                                continue
                            context = {
                                "endpoint": "top-news",
                                "endpoint_family": "news",
                                "source_country": country,
                                "language": language,
                                "cluster_id": cluster_id,
                                **response_meta,
                            }
                            yield item, context
                    else:
                        context = {
                            "endpoint": "top-news",
                            "endpoint_family": "news",
                            "source_country": country,
                            "language": language,
                            "cluster_id": cluster_id,
                            **response_meta,
                        }
                        yield cluster, context

                calls += 1

    async def _iter_front_pages(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        countries = self._coerce_string_list(config.get_setting("front_page_source_countries"))
        if not countries:
            return
        languages = self._coerce_string_list(config.get_setting("front_page_languages")) or [None]

        for country in countries:
            for language in languages:
                params: dict[str, Any] = {"source-country": country}
                if language:
                    params["language"] = language
                date_value = config.get_setting("front_page_date")
                if date_value:
                    params["date"] = str(date_value)
                params.update(self._coerce_dict(config.get_setting("front_pages_params")))

                payload, response_meta = await self._request_json_with_fallback(
                    client=client,
                    config=config,
                    paths=self.FRONT_PAGE_PATHS,
                    operation="front_pages",
                    params=params,
                )

                front_pages = payload.get("front_pages") or payload.get("front-pages") or payload.get("news")
                if front_pages is None:
                    front_pages = payload if isinstance(payload, list) else []
                if not isinstance(front_pages, list):
                    continue

                for front_page in front_pages:
                    if not isinstance(front_page, dict):
                        continue
                    front_page_name = (
                        front_page.get("name")
                        or front_page.get("paper")
                        or front_page.get("title")
                    )
                    nested_news = front_page.get("news")
                    if isinstance(nested_news, list):
                        for item in nested_news:
                            if not isinstance(item, dict):
                                continue
                            context = {
                                "endpoint": "front-pages",
                                "endpoint_family": "news",
                                "source_country": country,
                                "language": language,
                                "front_page_name": front_page_name,
                                **response_meta,
                            }
                            yield item, context
                    else:
                        context = {
                            "endpoint": "front-pages",
                            "endpoint_family": "news",
                            "source_country": country,
                            "language": language,
                            "front_page_name": front_page_name,
                            **response_meta,
                        }
                        yield front_page, context

    async def _iter_retrieve_news(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        ids = self._coerce_string_list(config.get_setting("retrieve_ids"))
        if not ids:
            return
        chunk_size = max(1, min(int(config.get_setting("retrieve_chunk_size") or 100), 500))

        for idx in range(0, len(ids), chunk_size):
            chunk = ids[idx : idx + chunk_size]
            payload, response_meta = await self._request_json(
                client=client,
                config=config,
                path=self.RETRIEVE_NEWS_PATH,
                operation="retrieve_news",
                params={"ids": ",".join(chunk), **self._coerce_dict(config.get_setting("retrieve_news_params"))},
            )
            items = self._extract_news_items(payload)
            for item in items:
                context = {
                    "endpoint": "retrieve-news",
                    "endpoint_family": "news",
                    "requested_id_count": len(chunk),
                    **response_meta,
                }
                yield item, context

    async def _iter_extract_news(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        urls = self._coerce_string_list(config.get_setting("extract_urls"))
        if not urls:
            return

        for target_url in urls:
            payload, response_meta = await self._request_json(
                client=client,
                config=config,
                path=self.EXTRACT_NEWS_PATH,
                operation="extract_news",
                params={"url": target_url, **self._coerce_dict(config.get_setting("extract_news_params"))},
            )

            items = self._extract_news_items(payload)
            if not items and isinstance(payload, dict):
                items = [payload]

            for item in items:
                context = {
                    "endpoint": "extract-news",
                    "endpoint_family": "enrichment",
                    "requested_url": target_url,
                    **response_meta,
                }
                yield item, context

    async def _iter_extract_news_links(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        urls = self._coerce_string_list(config.get_setting("extract_links_urls"))
        if not urls:
            return

        for target_url in urls:
            payload, response_meta = await self._request_json(
                client=client,
                config=config,
                path=self.EXTRACT_NEWS_LINKS_PATH,
                operation="extract_news_links",
                params={"url": target_url, **self._coerce_dict(config.get_setting("extract_news_links_params"))},
            )

            links = payload.get("news_links") or payload.get("links") or []
            if not isinstance(links, list):
                links = []
            for link in links:
                if isinstance(link, str):
                    item = {"url": link, "_record_kind": "article_link"}
                elif isinstance(link, dict):
                    item = dict(link)
                    item["_record_kind"] = item.get("_record_kind") or "article_link"
                else:
                    continue

                context = {
                    "endpoint": "extract-news-links",
                    "endpoint_family": "enrichment",
                    "requested_url": target_url,
                    **response_meta,
                }
                yield item, context

    async def _iter_feed_rss(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        urls = self._coerce_string_list(config.get_setting("feed_rss_urls"))
        if not urls:
            return

        for target_url in urls:
            text, response_meta = await self._request_text(
                client=client,
                config=config,
                path=self.FEED_RSS_PATH,
                operation="feed_rss",
                params={"url": target_url, **self._coerce_dict(config.get_setting("feed_rss_params"))},
            )
            for item in self._parse_rss_items(target_url, text):
                context = {
                    "endpoint": "feed.rss",
                    "endpoint_family": "enrichment",
                    "requested_url": target_url,
                    **response_meta,
                }
                yield item, context

    async def _iter_search_news_sources(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        terms = self._coerce_string_list(config.get_setting("source_search_terms"))
        if not terms:
            return

        for term in terms:
            payload, response_meta = await self._request_json(
                client=client,
                config=config,
                path=self.SEARCH_NEWS_SOURCES_PATH,
                operation="search_news_sources",
                params={"name": term, **self._coerce_dict(config.get_setting("search_news_sources_params"))},
            )
            sources = payload.get("news_sources") or payload.get("sources") or []
            if not isinstance(sources, list):
                sources = []

            for source in sources:
                if not isinstance(source, dict):
                    continue
                item = dict(source)
                item["_record_kind"] = "news_source"
                context = {
                    "endpoint": "search-news-sources",
                    "endpoint_family": "source_lifecycle",
                    "search_term": term,
                    **response_meta,
                }
                yield item, context

    async def _iter_suggest_news_source(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
    ) -> AsyncIterator[tuple[dict[str, Any], dict[str, Any]]]:
        suggestions = config.get_setting("source_suggestions") or []
        if not isinstance(suggestions, list):
            return

        for suggestion in suggestions:
            if not isinstance(suggestion, dict):
                continue
            body = {
                "url": suggestion.get("url"),
                "feed-url": suggestion.get("feed_url") or suggestion.get("feed-url"),
                "name": suggestion.get("name"),
                "language": suggestion.get("language"),
                "country": suggestion.get("country"),
            }
            payload, response_meta = await self._request_json(
                client=client,
                config=config,
                path=self.SUGGEST_NEWS_SOURCE_PATH,
                operation="suggest_news_source",
                method="POST",
                json_payload={k: v for k, v in body.items() if v is not None},
            )
            item = {
                "_record_kind": "suggestion_result",
                "request": suggestion,
                "response": payload,
            }
            context = {
                "endpoint": "suggest-news-source",
                "endpoint_family": "source_lifecycle",
                **response_meta,
            }
            yield item, context

    async def _request_json_with_fallback(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        paths: tuple[str, ...],
        operation: str,
        params: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        last_error: Exception | None = None
        for path in paths:
            try:
                return await self._request_json(
                    client=client,
                    config=config,
                    path=path,
                    operation=operation,
                    params=params,
                )
            except FileNotFoundError as exc:
                last_error = exc
                continue
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"No available fallback paths for operation {operation}")

    async def _request_json(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        path: str,
        operation: str,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        response, latency = await self._request(
            client=client,
            config=config,
            path=path,
            operation=operation,
            method=method,
            params=params,
            json_payload=json_payload,
        )
        try:
            payload = response.json()
        except Exception as exc:
            raise ValueError(f"World News API returned non-JSON payload for {path}") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"World News API returned invalid payload shape for {path}")
        metadata = {
            "latency_seconds": latency,
            "status_code": response.status_code,
            "quota": self._extract_quota_snapshot(response.headers),
        }
        return payload, metadata

    async def _request_text(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        path: str,
        operation: str,
        params: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        response, latency = await self._request(
            client=client,
            config=config,
            path=path,
            operation=operation,
            method="GET",
            params=params,
        )
        text = response.text or ""
        metadata = {
            "latency_seconds": latency,
            "status_code": response.status_code,
            "quota": self._extract_quota_snapshot(response.headers),
        }
        return text, metadata

    async def _request(
        self,
        *,
        client: httpx.AsyncClient,
        config: ConnectorConfig,
        path: str,
        operation: str,
        method: str,
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> tuple[httpx.Response, float]:
        started = time.monotonic()
        response = await connector_request(
            connector=self,
            config=config,
            client=client,
            method=method,
            url=self._build_url(path),
            operation=operation,
            headers=self._build_headers(config),
            params=params,
            json=json_payload,
        )
        latency = max(0.0, time.monotonic() - started)
        self._metric_observe_ingest_latency(path, response.status_code, latency, config)
        self._metric_track_quota(path, response.headers)
        await self._apply_dynamic_backoff(config, response.headers)
        self._raise_for_response(response=response, path=path)
        return response, latency

    def _raise_for_response(
        self,
        *,
        response: httpx.Response,
        path: str,
    ) -> None:
        status = response.status_code
        if status < 400:
            return
        if status == 401:
            raise PermissionError("World News API authentication failed (401)")
        if status == 402:
            raise RuntimeError("World News API quota exhausted (402)")
        if status == 404:
            raise FileNotFoundError(f"World News API endpoint not found: {path}")
        if status == 429:
            raise RuntimeError("World News API rate limited (429)")
        if status >= 500:
            raise RuntimeError(f"World News API server error ({status})")
        response.raise_for_status()

    async def _apply_dynamic_backoff(
        self,
        config: ConnectorConfig,
        headers: httpx.Headers,
    ) -> None:
        if not bool(config.get_setting("quota_backoff_enabled", True)):
            return

        retry_after = self._parse_float(headers.get("Retry-After"))
        if retry_after and retry_after > 0:
            max_retry_after = float(config.get_setting("max_retry_after_seconds") or 60.0)
            await asyncio.sleep(min(retry_after, max_retry_after))
            return

        quota_left = self._parse_int(headers.get("X-API-Quota-Left"))
        if quota_left is None:
            quota_left = self._parse_int(headers.get("x-api-quota-left"))
        if quota_left is None:
            return

        watermark = max(0, int(config.get_setting("quota_low_watermark") or 20))
        if quota_left > watermark:
            return
        max_backoff = float(config.get_setting("max_quota_backoff_seconds") or 8.0)
        delay = min(max_backoff, 0.2 * float((watermark - quota_left) + 1))
        if delay > 0:
            await asyncio.sleep(delay)

    def _build_search_news_params(
        self,
        *,
        config: ConnectorConfig,
        query: str,
        offset: int,
        page_size: int,
        stream: StreamConfig,
        cursor_cutoff: str | None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "text": query,
            "number": page_size,
            "offset": max(0, offset),
            "sort": str(config.get_setting("search_sort") or "publish-time"),
        }

        source_countries = self._coerce_string_list(config.get_setting("source_countries"))
        if source_countries:
            params["source-country"] = ",".join(source_countries)

        languages = self._coerce_string_list(config.get_setting("languages"))
        if languages:
            params["language"] = ",".join(languages)

        categories = self._coerce_string_list(config.get_setting("categories"))
        if categories:
            params["categories"] = ",".join(categories)

        news_sources = self._coerce_string_list(config.get_setting("news_sources"))
        if news_sources:
            params["news-sources"] = ",".join(news_sources)

        earliest_publish = config.get_setting("earliest_publish_date")
        if (
            stream.sync_mode == SyncMode.INCREMENTAL
            and not earliest_publish
            and cursor_cutoff
        ):
            earliest_publish = cursor_cutoff
        if earliest_publish:
            params["earliest-publish-date"] = str(earliest_publish)

        latest_publish = config.get_setting("latest_publish_date")
        if latest_publish:
            params["latest-publish-date"] = str(latest_publish)

        params.update(self._coerce_dict(config.get_setting("search_news_params")))
        return params

    def _build_query_plan(self, config: ConnectorConfig) -> list[str]:
        base_queries = self._coerce_string_list(config.get_setting("search_queries"))
        entity_exposure = self._coerce_string_list(config.get_setting("entity_exposure"))
        hypothesis_context = self._coerce_string_list(config.get_setting("hypothesis_context"))
        query_templates = self._coerce_string_list(config.get_setting("query_templates"))

        generated: list[str] = []
        # Breadth-first plan: include direct entity/hypothesis shards before
        # combinatorial expansions so small max_query_shards still preserve coverage.
        generated.extend(entity_exposure)
        generated.extend(hypothesis_context)
        for entity in entity_exposure:
            for hypothesis in hypothesis_context:
                if query_templates:
                    for template in query_templates:
                        try:
                            generated.append(
                                template.format(entity=entity, hypothesis=hypothesis)
                            )
                        except Exception:
                            generated.append(f'"{entity}" AND ({hypothesis})')
                else:
                    generated.append(f'"{entity}" AND ({hypothesis})')

        default_query = str(config.get_setting("default_search_query") or "").strip()
        if default_query:
            generated.append(default_query)

        deduped = self._dedupe_preserve_order(base_queries + generated)
        max_shards = max(1, min(int(config.get_setting("max_query_shards") or 25), 500))
        return deduped[:max_shards]

    def _normalize_candidate(
        self,
        candidate: dict[str, Any],
        context: dict[str, Any],
        config: ConnectorConfig,
    ) -> dict[str, Any]:
        endpoint = str(context.get("endpoint") or "unknown")
        endpoint_family = str(context.get("endpoint_family") or "unknown")
        observed_at = datetime.now(timezone.utc).isoformat()
        kind = str(candidate.get("_record_kind") or "article")
        if kind == "article_link":
            # Canonical dedupe must collapse across endpoint families.
            # Treat extract-news-links entries as sparse article candidates.
            kind = "article"

        if kind != "article":
            dedupe_key = self._fallback_dedupe_key(kind, endpoint, candidate)
            return {
                "provider": "worldnewsapi",
                "record_kind": kind,
                "endpoint": endpoint,
                "endpoint_family": endpoint_family,
                "source_id": candidate.get("id") or candidate.get("source_id"),
                "name": candidate.get("name"),
                "url": candidate.get("url") or candidate.get("feed-url") or candidate.get("feed_url"),
                "country": candidate.get("country"),
                "language": candidate.get("language"),
                "request": candidate.get("request"),
                "response": candidate.get("response"),
                "quality": {
                    "dedupe_key": dedupe_key,
                    "reliability_score": self._calibrate_reliability(
                        candidate=candidate,
                        endpoint=endpoint,
                        config=config,
                    ),
                    "latency_slo_seconds": float(config.get_setting("latency_slo_seconds") or 5.0),
                    "latency_observed_seconds": context.get("latency_seconds"),
                },
                "context": context,
                "observed_at": observed_at,
                "dedupe_key": dedupe_key,
                "raw": candidate,
            }

        article_id = candidate.get("id") or candidate.get("news_id") or candidate.get("article_id")
        url = candidate.get("url") or candidate.get("link")
        publish_date = self._normalize_datetime(
            candidate.get("publish_date")
            or candidate.get("publish-date")
            or candidate.get("published")
            or candidate.get("published_at")
            or candidate.get("date")
        )
        normalized_url = self._normalize_url(url)
        dedupe_key = self._canonical_dedupe_key(article_id, normalized_url, publish_date)
        reliability = self._calibrate_reliability(
            candidate=candidate,
            endpoint=endpoint,
            config=config,
        )
        latency_slo_seconds = float(config.get_setting("latency_slo_seconds") or 5.0)
        latency_observed = context.get("latency_seconds")

        return {
            "provider": "worldnewsapi",
            "record_kind": "article",
            "endpoint": endpoint,
            "endpoint_family": endpoint_family,
            "article_id": article_id,
            "title": candidate.get("title"),
            "url": normalized_url,
            "image": candidate.get("image"),
            "video": candidate.get("video"),
            "summary": candidate.get("summary"),
            "text": candidate.get("text"),
            "publish_date": publish_date,
            "authors": candidate.get("authors"),
            "source_name": candidate.get("source") or candidate.get("news_source"),
            "source_country": candidate.get("source_country") or candidate.get("source-country"),
            "language": candidate.get("language"),
            "sentiment": candidate.get("sentiment"),
            "quality": {
                "dedupe_key": dedupe_key,
                "reliability_score": reliability,
                "latency_slo_seconds": latency_slo_seconds,
                "latency_observed_seconds": latency_observed,
                "latency_slo_breached": bool(
                    isinstance(latency_observed, (float, int)) and latency_observed > latency_slo_seconds
                ),
            },
            "context": context,
            "observed_at": observed_at,
            "dedupe_key": dedupe_key,
            "raw": candidate,
        }

    def _extract_news_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        candidates = payload.get("news")
        if isinstance(candidates, list):
            return [item for item in candidates if isinstance(item, dict)]
        if isinstance(candidates, dict):
            return [candidates]
        return []

    def _extract_quota_snapshot(self, headers: httpx.Headers) -> dict[str, int | None]:
        request_points = self._parse_int(headers.get("X-API-Quota-Request"))
        if request_points is None:
            request_points = self._parse_int(headers.get("x-api-quota-request"))
        quota_left = self._parse_int(headers.get("X-API-Quota-Left"))
        if quota_left is None:
            quota_left = self._parse_int(headers.get("x-api-quota-left"))
        quota_limit = self._parse_int(headers.get("X-API-Quota-Limit"))
        if quota_limit is None:
            quota_limit = self._parse_int(headers.get("x-api-quota-limit"))
        return {
            "request_points": request_points,
            "quota_left": quota_left,
            "quota_limit": quota_limit,
        }

    def _metric_observe_ingest_latency(
        self,
        path: str,
        status_code: int,
        latency_seconds: float,
        config: ConnectorConfig,
    ) -> None:
        endpoint = path.strip("/") or "root"
        if _ingest_latency_seconds is not None:
            try:
                _ingest_latency_seconds.labels(endpoint=endpoint, status=str(status_code)).observe(
                    latency_seconds
                )
            except Exception:
                pass
        latency_slo_seconds = float(config.get_setting("latency_slo_seconds") or 5.0)
        if latency_seconds > latency_slo_seconds and _latency_slo_violations_total is not None:
            try:
                _latency_slo_violations_total.labels(endpoint=endpoint).inc()
            except Exception:
                pass

    def _metric_track_quota(self, path: str, headers: httpx.Headers) -> None:
        if _quota_burn_points_total is None:
            return
        endpoint = path.strip("/") or "root"
        request_points = self._parse_int(headers.get("X-API-Quota-Request"))
        if request_points is None:
            request_points = self._parse_int(headers.get("x-api-quota-request"))
        if request_points is None or request_points <= 0:
            return
        try:
            _quota_burn_points_total.labels(endpoint=endpoint).inc(request_points)
        except Exception:
            pass

    def _metric_inc_duplicate_collapsed(self, endpoint_family: str) -> None:
        if _duplicate_collapsed_total is None:
            return
        try:
            _duplicate_collapsed_total.labels(endpoint_family=endpoint_family).inc()
        except Exception:
            pass

    def _metric_inc_publish(self, status: str) -> None:
        if _publish_total is None:
            return
        try:
            _publish_total.labels(status=status).inc()
        except Exception:
            pass

    def _metric_set_duplicate_ratio(self, duplicates_collapsed: int, candidates_seen: int) -> None:
        if _duplicate_collapse_ratio is None:
            return
        denominator = max(1, candidates_seen)
        ratio = float(duplicates_collapsed) / float(denominator)
        try:
            _duplicate_collapse_ratio.labels(connector_type=self.connector_type).set(ratio)
        except Exception:
            pass

    def _metric_set_publish_success_ratio(self, emitted: int, publish_failures: int) -> None:
        if _publish_success_ratio is None:
            return
        denominator = max(1, emitted + publish_failures)
        ratio = float(emitted) / float(denominator)
        try:
            _publish_success_ratio.labels(connector_type=self.connector_type).set(ratio)
        except Exception:
            pass

    def _build_next_cursor(
        self,
        newest_publish: str | None,
        offset_by_shard: dict[str, int],
    ) -> dict[str, Any]:
        cursor: dict[str, Any] = {
            "offset_by_shard": offset_by_shard,
        }
        if newest_publish:
            cursor["last_publish_date"] = newest_publish
        return cursor

    def _resolve_api_key(self, config: ConnectorConfig) -> str | None:
        return (
            config.get_credential("api_key")
            or config.get_setting("api_key")
            or get_settings().world_news_api_key
        )

    def _build_headers(self, config: ConnectorConfig) -> dict[str, str]:
        api_key = self._resolve_api_key(config)
        if not api_key:
            return {}
        return {
            self.API_KEY_HEADER: str(api_key),
            "Accept": "application/json",
        }

    def _build_url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return f"{self.BASE_URL}{path}"

    def _query_shard(self, query: str) -> str:
        digest = hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]
        return f"q_{digest}"

    def _canonical_dedupe_key(
        self,
        article_id: Any,
        url: Any,
        publish_date: Any,
    ) -> str:
        material = f"{str(article_id or '').strip()}|{str(url or '').strip()}|{str(publish_date or '').strip()}"
        digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]
        return f"wn:{digest}"

    def _fallback_dedupe_key(
        self,
        kind: str,
        endpoint: str,
        payload: dict[str, Any],
    ) -> str:
        material = json.dumps(payload, sort_keys=True, default=str)
        digest = hashlib.sha256(f"{kind}|{endpoint}|{material}".encode("utf-8")).hexdigest()[:24]
        return f"wn:{digest}"

    def _normalize_url(self, raw_url: Any) -> str | None:
        if raw_url is None:
            return None
        value = str(raw_url).strip()
        if not value:
            return None
        parsed = urlparse(value)
        if not parsed.scheme or not parsed.netloc:
            return value
        query_pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
        normalized = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            path=parsed.path.rstrip("/"),
            params="",
            query=urlencode(query_pairs, doseq=True),
            fragment="",
        )
        return urlunparse(normalized)

    def _calibrate_reliability(
        self,
        *,
        candidate: dict[str, Any],
        endpoint: str,
        config: ConnectorConfig,
    ) -> float:
        overrides = self._coerce_dict(config.get_setting("source_reliability_overrides"))
        source_url = self._normalize_url(candidate.get("url") or candidate.get("link"))
        domain = ""
        if source_url:
            domain = urlparse(source_url).netloc.lower()
        if domain and domain in overrides:
            return self._clamp_float(overrides[domain], 0.0, 1.0)

        score = 0.45
        if endpoint in {"search-news", "top-news", "retrieve-news"}:
            score += 0.1
        if endpoint in {"extract-news", "feed.rss"}:
            score += 0.05
        if candidate.get("source_country") or candidate.get("source-country"):
            score += 0.05
        if candidate.get("authors"):
            score += 0.04
        text_value = str(candidate.get("text") or candidate.get("summary") or "")
        if len(text_value) >= 240:
            score += 0.08
        if domain:
            if domain.endswith(".gov") or domain.endswith(".edu"):
                score += 0.12
            elif domain.endswith(".org"):
                score += 0.06
        return self._clamp_float(score, 0.0, 1.0)

    def _parse_rss_items(self, requested_url: str, payload: str) -> list[dict[str, Any]]:
        try:
            root = ElementTree.fromstring(payload)
        except Exception:
            return []
        root_name = self._local_name(root.tag).lower()
        if root_name == "rss":
            channel = self._first_child(root, {"channel"})
            if channel is None:
                return []
            items = self._children(channel, {"item"})
            results: list[dict[str, Any]] = []
            for item in items:
                title = self._child_text(item, {"title"})
                link = self._child_text(item, {"link"})
                summary = self._child_text(item, {"description"})
                pub_date = self._child_text(item, {"pubDate", "published"})
                results.append(
                    {
                        "title": title,
                        "url": link,
                        "summary": summary,
                        "publish_date": self._normalize_datetime(pub_date),
                        "feed_url": requested_url,
                    }
                )
            return results
        if root_name == "feed":
            entries = self._children(root, {"entry"})
            results = []
            for entry in entries:
                title = self._child_text(entry, {"title"})
                summary = self._child_text(entry, {"summary", "content"})
                published = self._child_text(entry, {"published", "updated"})
                link = self._atom_link(entry)
                results.append(
                    {
                        "title": title,
                        "url": link,
                        "summary": summary,
                        "publish_date": self._normalize_datetime(published),
                        "feed_url": requested_url,
                    }
                )
            return results
        return []

    def _children(self, parent: ElementTree.Element, names: set[str]) -> list[ElementTree.Element]:
        wanted = {name.lower() for name in names}
        return [child for child in list(parent) if self._local_name(child.tag).lower() in wanted]

    def _first_child(self, parent: ElementTree.Element, names: set[str]) -> ElementTree.Element | None:
        children = self._children(parent, names)
        return children[0] if children else None

    def _child_text(self, parent: ElementTree.Element, names: set[str]) -> str | None:
        child = self._first_child(parent, names)
        if child is None:
            return None
        value = (child.text or "").strip()
        return value or None

    def _atom_link(self, parent: ElementTree.Element) -> str | None:
        for child in list(parent):
            if self._local_name(child.tag).lower() != "link":
                continue
            href = str(child.attrib.get("href") or "").strip()
            if href:
                return href
            value = (child.text or "").strip()
            if value:
                return value
        return None

    def _local_name(self, tag: str) -> str:
        if "}" in tag:
            return tag.rsplit("}", 1)[1]
        return tag

    def _normalize_datetime(self, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()

        raw = str(value).strip()
        if not raw:
            return None

        try:
            if raw.endswith("Z"):
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                dt = datetime.fromisoformat(raw)
        except Exception:
            try:
                dt = parsedate_to_datetime(raw)
            except Exception:
                return raw

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()

    def _coerce_string_list(self, value: Any) -> list[str]:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    def _coerce_dict(self, value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    def _coerce_int_map(self, value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, int] = {}
        for key, raw in value.items():
            parsed = self._parse_int(raw)
            if parsed is None:
                continue
            result[str(key)] = max(0, parsed)
        return result

    def _parse_int(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(str(value).strip())
        except Exception:
            return None

    def _parse_float(self, value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(str(value).strip())
        except Exception:
            return None

    def _clamp_float(self, value: Any, minimum: float, maximum: float) -> float:
        try:
            parsed = float(value)
        except Exception:
            parsed = minimum
        return max(minimum, min(maximum, parsed))

    def _dedupe_preserve_order(self, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            key = value.strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(value.strip())
        return result

    def _is_enabled(
        self,
        config: ConnectorConfig,
        setting: str,
        *,
        default: bool,
    ) -> bool:
        value = config.get_setting(setting)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)


ConnectorRegistry.register("worldnewsapi", WorldNewsApiConnector)
