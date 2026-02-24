"""
RSS / OSINT connector.

Supports RSS2 and Atom feeds with normalized item extraction.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
from typing import Any
from urllib.parse import urljoin
from xml.etree import ElementTree

import httpx

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.cursors import compare_cursor_values
from src.connectors.http_client import connector_request
from src.connectors.sources.world.rss_osint_definition import CAPABILITIES, default_streams


class RssOsintConnector(BaseConnector):
    """Connector interface for RSS and OSINT feed families."""

    connector_type = "rss_osint"
    capabilities = CAPABILITIES

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        feed_urls = self._feed_urls(config)
        if not feed_urls:
            return False, "Missing `feed_urls` setting"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=feed_urls[0],
                    operation="check_connection",
                )
            if response.status_code >= 400:
                return False, f"Feed returned status {response.status_code}"
            self._parse_feed(feed_urls[0], response.text)
            return True, None
        except Exception as exc:
            return False, f"RSS/OSINT connection failed: {exc}"

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
        if stream.stream_name != "items":
            raise ValueError(f"Unknown stream for rss_osint: {stream.stream_name}")

        feed_urls = self._feed_urls(config)
        if not feed_urls:
            return

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_field = stream.cursor_field or "published_at"
        cursor_cutoff = cursor.get(cursor_field)

        batch_size = max(1, int(stream.batch_size or 100))
        max_items_per_feed = max(1, int(config.get_setting("max_items_per_feed") or 250))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        emitted = 0
        newest_cursor = cursor_cutoff
        batch = self.create_batch(stream.stream_name, config.connection_id)

        async with httpx.AsyncClient(timeout=45.0) as client:
            for feed_url in feed_urls:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=feed_url,
                    operation="read_feed",
                )
                response.raise_for_status()
                items = self._parse_feed(feed_url, response.text)[:max_items_per_feed]

                for item in items:
                    published_at = item.get("published_at")
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff is not None
                        and published_at is not None
                    ):
                        compare = compare_cursor_values(cursor_cutoff, published_at)
                        if compare.comparable and not compare.is_forward_or_equal:
                            continue
                        if compare.comparable and str(published_at) == str(cursor_cutoff):
                            continue

                    record = self.create_record(
                        record_id=str(item["item_id"]),
                        stream_name=stream.stream_name,
                        data=item,
                        cursor_value=published_at,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if published_at is not None:
                        if newest_cursor is None:
                            newest_cursor = published_at
                        else:
                            compare_newest = compare_cursor_values(newest_cursor, published_at)
                            if (not compare_newest.comparable) or compare_newest.is_forward_or_equal:
                                newest_cursor = published_at

                    if len(batch.records) >= batch_size:
                        next_cursor = {cursor_field: newest_cursor} if newest_cursor is not None else None
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

        if batch.records:
            next_cursor = {cursor_field: newest_cursor} if newest_cursor is not None else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _feed_urls(self, config: ConnectorConfig) -> list[str]:
        raw = config.get_setting("feed_urls", [])
        if isinstance(raw, str):
            raw = [segment.strip() for segment in raw.split(",") if segment.strip()]
        if not isinstance(raw, list):
            return []
        values = [str(feed).strip() for feed in raw if str(feed).strip()]
        return values

    def _parse_feed(self, feed_url: str, xml_text: str) -> list[dict[str, Any]]:
        root = ElementTree.fromstring(xml_text)
        root_name = self._local_name(root.tag).lower()
        if root_name == "rss":
            return self._parse_rss(feed_url, root)
        if root_name == "feed":
            return self._parse_atom(feed_url, root)
        return []

    def _parse_rss(self, feed_url: str, root: ElementTree.Element) -> list[dict[str, Any]]:
        channel = self._first_child(root, {"channel"})
        if channel is None:
            return []
        feed_title = self._child_text(channel, {"title"})
        results: list[dict[str, Any]] = []
        for item in self._children(channel, {"item"}):
            title = self._child_text(item, {"title"})
            link = self._child_text(item, {"link"})
            guid = self._child_text(item, {"guid"})
            description = self._child_text(item, {"description"})
            pub_date = self._child_text(item, {"pubDate", "published"})
            published_at = self._normalize_datetime(pub_date)
            item_id = self._item_id(feed_url, guid or link or title or description or "")
            results.append(
                {
                    "item_id": item_id,
                    "feed_url": feed_url,
                    "feed_title": feed_title,
                    "title": title,
                    "url": self._absolute_url(feed_url, link),
                    "summary": description,
                    "published_at": published_at,
                    "source_type": "rss",
                }
            )
        return results

    def _parse_atom(self, feed_url: str, root: ElementTree.Element) -> list[dict[str, Any]]:
        feed_title = self._child_text(root, {"title"})
        results: list[dict[str, Any]] = []
        for entry in self._children(root, {"entry"}):
            title = self._child_text(entry, {"title"})
            link = self._atom_link(entry)
            entry_id = self._child_text(entry, {"id"})
            summary = self._child_text(entry, {"summary", "content"})
            published = self._child_text(entry, {"published", "updated"})
            published_at = self._normalize_datetime(published)
            item_id = self._item_id(feed_url, entry_id or link or title or summary or "")
            results.append(
                {
                    "item_id": item_id,
                    "feed_url": feed_url,
                    "feed_title": feed_title,
                    "title": title,
                    "url": self._absolute_url(feed_url, link),
                    "summary": summary,
                    "published_at": published_at,
                    "source_type": "atom",
                }
            )
        return results

    def _children(self, parent: ElementTree.Element, names: set[str]) -> list[ElementTree.Element]:
        wanted = {name.lower() for name in names}
        return [
            child
            for child in list(parent)
            if self._local_name(child.tag).lower() in wanted
        ]

    def _first_child(
        self,
        parent: ElementTree.Element,
        names: set[str],
    ) -> ElementTree.Element | None:
        children = self._children(parent, names)
        return children[0] if children else None

    def _child_text(self, parent: ElementTree.Element, names: set[str]) -> str | None:
        child = self._first_child(parent, names)
        if child is None:
            return None
        text = (child.text or "").strip()
        return text or None

    def _atom_link(self, entry: ElementTree.Element) -> str | None:
        for child in list(entry):
            if self._local_name(child.tag).lower() != "link":
                continue
            href = str(child.attrib.get("href") or "").strip()
            if href:
                return href
            text = (child.text or "").strip()
            if text:
                return text
        return None

    def _absolute_url(self, base: str, maybe_relative: str | None) -> str | None:
        if not maybe_relative:
            return None
        return urljoin(base, maybe_relative)

    def _item_id(self, feed_url: str, value: str) -> str:
        digest = hashlib.sha256(f"{feed_url}|{value}".encode("utf-8")).hexdigest()[:24]
        return f"rss:{digest}"

    def _normalize_datetime(self, value: str | None) -> str | None:
        if not value:
            return None
        raw = value.strip()
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

    def _local_name(self, tag: str) -> str:
        if "}" in tag:
            return tag.rsplit("}", 1)[1]
        return tag


ConnectorRegistry.register("rss_osint", RssOsintConnector)

