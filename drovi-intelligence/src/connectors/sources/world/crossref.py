"""
Crossref connector.

Ingests scholarly metadata for DOI-indexed publications.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http_client import connector_request
from src.connectors.sources.world.crossref_definition import CAPABILITIES, default_streams


class CrossrefConnector(BaseConnector):
    """Connector for Crossref REST API."""

    connector_type = "crossref"
    capabilities = CAPABILITIES

    WORKS_URL = "https://api.crossref.org/works"
    DEFAULT_USER_AGENT = "Drovi Intelligence/1.0 (mailto:support@drovi.co)"

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        params = {"rows": 1, "sort": "updated", "order": "desc"}
        mailto = config.get_setting("mailto")
        if mailto:
            params["mailto"] = str(mailto)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=self.WORKS_URL,
                    operation="check_connection",
                    params=params,
                    headers={"User-Agent": self._user_agent(config)},
                )
            if response.status_code >= 400:
                return False, f"Crossref returned status {response.status_code}"
            payload = response.json()
            if not isinstance(payload, dict):
                return False, "Unexpected Crossref payload shape"
            return True, None
        except Exception as exc:
            return False, f"Crossref connection failed: {exc}"

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
        if stream.stream_name != "works":
            raise ValueError(f"Unknown stream for crossref: {stream.stream_name}")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = str(cursor.get("indexed_at") or "")

        batch_size = max(1, min(int(stream.batch_size or 100), 1000))
        max_pages = int(config.get_setting("max_pages", 20))
        max_pages = max(1, min(max_pages, 200))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        emitted = 0
        page_count = 0
        newest_cursor: str | None = cursor_cutoff or None
        batch = self.create_batch(stream.stream_name, config.connection_id)
        cursor_token = "*"

        async with httpx.AsyncClient(timeout=45.0) as client:
            while page_count < max_pages:
                params = self._build_params(config, batch_size, cursor_token, cursor_cutoff, stream)
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=self.WORKS_URL,
                    operation="read_works",
                    params=params,
                    headers={"User-Agent": self._user_agent(config)},
                )
                response.raise_for_status()
                payload = response.json()
                message = payload.get("message", {})
                if not isinstance(message, dict):
                    break

                items = message.get("items", [])
                if not isinstance(items, list) or not items:
                    break

                for item in items:
                    if not isinstance(item, dict):
                        continue
                    indexed_at = self._extract_indexed_datetime(item)
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff
                        and indexed_at
                        and indexed_at <= cursor_cutoff
                    ):
                        continue

                    normalized = self._normalize_item(item, indexed_at)
                    doi = str(normalized.get("doi") or "").strip()
                    record_id = doi or str(normalized.get("url") or normalized.get("title") or "work")

                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=normalized,
                        cursor_value=indexed_at or None,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if indexed_at and (newest_cursor is None or indexed_at > newest_cursor):
                        newest_cursor = indexed_at

                    if len(batch.records) >= batch_size:
                        next_cursor = {"indexed_at": newest_cursor} if newest_cursor else None
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

                next_cursor_token = message.get("next-cursor")
                if not isinstance(next_cursor_token, str) or not next_cursor_token:
                    break
                if next_cursor_token == cursor_token:
                    break

                cursor_token = next_cursor_token
                page_count += 1

        if batch.records:
            next_cursor = {"indexed_at": newest_cursor} if newest_cursor else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _build_params(
        self,
        config: ConnectorConfig,
        rows: int,
        cursor_token: str,
        cursor_cutoff: str,
        stream: StreamConfig,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "rows": rows,
            "cursor": cursor_token,
            "sort": "updated",
            "order": "asc",
            "select": "DOI,title,URL,type,published,indexed,container-title,publisher,subject,author,created,is-referenced-by-count,score",
        }

        filters: list[str] = []
        if stream.sync_mode == SyncMode.INCREMENTAL and cursor_cutoff:
            filters.append(f"from-index-date:{cursor_cutoff[:10]}")

        from_pub_date = config.get_setting("from_pub_date")
        until_pub_date = config.get_setting("until_pub_date")
        if from_pub_date:
            filters.append(f"from-pub-date:{from_pub_date}")
        if until_pub_date:
            filters.append(f"until-pub-date:{until_pub_date}")

        query = config.get_setting("query")
        if query:
            params["query"] = str(query)

        if filters:
            params["filter"] = ",".join(filters)

        mailto = config.get_setting("mailto")
        if mailto:
            params["mailto"] = str(mailto)

        return params

    def _extract_indexed_datetime(self, item: dict[str, Any]) -> str:
        indexed = item.get("indexed", {})
        if not isinstance(indexed, dict):
            return ""
        date_time = indexed.get("date-time")
        if isinstance(date_time, str):
            return date_time
        return ""

    def _normalize_item(self, item: dict[str, Any], indexed_at: str) -> dict[str, Any]:
        title = ""
        raw_titles = item.get("title", [])
        if isinstance(raw_titles, list) and raw_titles:
            title = str(raw_titles[0])

        container_title = ""
        raw_container = item.get("container-title", [])
        if isinstance(raw_container, list) and raw_container:
            container_title = str(raw_container[0])

        subjects = item.get("subject", [])
        if not isinstance(subjects, list):
            subjects = []

        authors = item.get("author", [])
        author_names: list[str] = []
        if isinstance(authors, list):
            for author in authors[:25]:
                if not isinstance(author, dict):
                    continue
                given = str(author.get("given") or "").strip()
                family = str(author.get("family") or "").strip()
                name = " ".join(part for part in (given, family) if part)
                if name:
                    author_names.append(name)

        return {
            "doi": item.get("DOI"),
            "title": title,
            "url": item.get("URL"),
            "type": item.get("type"),
            "publisher": item.get("publisher"),
            "container_title": container_title,
            "subjects": subjects,
            "authors": author_names,
            "indexed_at": indexed_at,
            "published": item.get("published"),
            "created": item.get("created"),
            "reference_count": item.get("is-referenced-by-count"),
            "score": item.get("score"),
        }

    def _user_agent(self, config: ConnectorConfig) -> str:
        mailto = config.get_setting("mailto")
        if mailto:
            return f"Drovi Intelligence/1.0 (mailto:{mailto})"
        return self.DEFAULT_USER_AGENT


ConnectorRegistry.register("crossref", CrossrefConnector)

