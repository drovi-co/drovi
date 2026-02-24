"""
Generic connector interface for commercial premium feeds.

This adapter is intentionally configuration-driven so each tenant can connect to
their own licensed provider endpoint with tenant-scoped credentials.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
import hashlib
import json
from typing import Any
from urllib.parse import urljoin

import httpx

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.cursors import compare_cursor_values
from src.connectors.http_client import connector_request
from src.connectors.sources.world.commercial_premium_definition import CAPABILITIES, default_streams


class CommercialPremiumConnector(BaseConnector):
    """Configuration-driven commercial feed connector with tenant credentials."""

    connector_type = "commercial_premium"
    capabilities = CAPABILITIES

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        base_url = str(config.get_setting("base_url") or "").strip()
        if not base_url:
            return False, "Missing `base_url` in provider settings"

        auth_headers, auth_params, auth_error = self._build_auth(config)
        if auth_error:
            return False, auth_error

        endpoint = str(config.get_setting("health_endpoint") or config.get_setting("endpoint") or "/")
        url = self._build_url(base_url, endpoint)
        params = {"limit": 1, **auth_params}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="check_connection",
                    headers=auth_headers,
                    params=params,
                )
            if response.status_code >= 400:
                return False, f"Provider returned status {response.status_code}"
            return True, None
        except Exception as exc:
            return False, f"Commercial feed connection failed: {exc}"

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
            raise ValueError(f"Unknown stream for commercial_premium: {stream.stream_name}")

        base_url = str(config.get_setting("base_url") or "").strip()
        if not base_url:
            raise ValueError("Missing `base_url` in provider settings")

        endpoint = str(config.get_setting("endpoint") or "/events")
        url = self._build_url(base_url, endpoint)
        result_path = str(config.get_setting("result_path") or "results")
        id_field = str(config.get_setting("id_field") or "id")
        cursor_field = str(config.get_setting("cursor_field") or stream.cursor_field or "updated_at")
        page_param = str(config.get_setting("page_param") or "page")
        page_size_param = str(config.get_setting("page_size_param") or "limit")
        page_size = max(1, int(config.get_setting("page_size") or stream.batch_size or 200))
        max_pages = max(1, min(int(config.get_setting("max_pages") or 20), 500))

        auth_headers, auth_params, auth_error = self._build_auth(config)
        if auth_error:
            raise ValueError(auth_error)

        user_params = config.get_setting("query_params") or {}
        if not isinstance(user_params, dict):
            user_params = {}

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = cursor.get(cursor_field)

        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None
        emitted = 0

        newest_cursor = cursor_cutoff
        page = 1
        batch = self.create_batch(stream.stream_name, config.connection_id)

        async with httpx.AsyncClient(timeout=45.0) as client:
            while page <= max_pages:
                params = {
                    **user_params,
                    **auth_params,
                    page_param: page,
                    page_size_param: page_size,
                }
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="read_events",
                    headers=auth_headers,
                    params=params,
                )
                response.raise_for_status()
                payload = response.json()
                items = self._extract_items(payload, result_path)
                if not items:
                    break

                for item in items:
                    record_cursor = item.get(cursor_field)
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff is not None
                        and record_cursor is not None
                    ):
                        compare = compare_cursor_values(cursor_cutoff, record_cursor)
                        if compare.comparable and not compare.is_forward_or_equal:
                            continue
                        if compare.comparable and str(record_cursor) == str(cursor_cutoff):
                            continue

                    normalized = {
                        "provider_name": config.name,
                        "connector_type": self.connector_type,
                        "base_url": base_url,
                        "endpoint": endpoint,
                        "fetched_at": datetime.utcnow().isoformat(),
                        "raw": item,
                    }

                    record_id = self._record_id(item, id_field)
                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=normalized,
                        cursor_value=record_cursor,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if record_cursor is not None:
                        if newest_cursor is None:
                            newest_cursor = record_cursor
                        else:
                            compare_newest = compare_cursor_values(newest_cursor, record_cursor)
                            if (not compare_newest.comparable) or compare_newest.is_forward_or_equal:
                                newest_cursor = record_cursor

                    if len(batch.records) >= page_size:
                        next_cursor = {cursor_field: newest_cursor} if newest_cursor is not None else None
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

                if len(items) < page_size:
                    break
                page += 1

        if batch.records:
            next_cursor = {cursor_field: newest_cursor} if newest_cursor is not None else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _build_url(self, base_url: str, endpoint: str) -> str:
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            return endpoint
        return urljoin(base_url.rstrip("/") + "/", endpoint.lstrip("/"))

    def _extract_items(self, payload: Any, result_path: str) -> list[dict[str, Any]]:
        current: Any = payload
        for segment in [part for part in result_path.split(".") if part]:
            if not isinstance(current, dict):
                return []
            current = current.get(segment)
        if isinstance(current, list):
            return [item for item in current if isinstance(item, dict)]
        if isinstance(current, dict):
            return [current]
        return []

    def _record_id(self, item: dict[str, Any], id_field: str) -> str:
        raw = item.get(id_field)
        if raw:
            return str(raw)
        payload = json.dumps(item, sort_keys=True, default=str).encode("utf-8")
        digest = hashlib.sha256(payload).hexdigest()[:20]
        return f"premium:{digest}"

    def _build_auth(
        self,
        config: ConnectorConfig,
    ) -> tuple[dict[str, str], dict[str, str], str | None]:
        mode = str(config.get_setting("auth_mode") or "api_key_header").strip().lower()
        headers: dict[str, str] = {}
        params: dict[str, str] = {}

        if mode == "none":
            return headers, params, None

        if mode == "basic":
            username = config.get_credential("username")
            password = config.get_credential("password")
            if not username or not password:
                return headers, params, "Missing `username`/`password` credentials for basic auth"
            token = f"{username}:{password}".encode("utf-8")
            import base64

            headers["Authorization"] = f"Basic {base64.b64encode(token).decode('ascii')}"
            return headers, params, None

        if mode == "bearer":
            token = config.get_credential("access_token") or config.get_credential("api_key")
            if not token:
                return headers, params, "Missing tenant credential `access_token` (or `api_key`) for bearer auth"
            headers["Authorization"] = f"Bearer {token}"
            return headers, params, None

        if mode == "api_key_query":
            api_key = config.get_credential("api_key")
            if not api_key:
                return headers, params, "Missing tenant credential `api_key` for query auth"
            key_name = str(config.get_setting("api_key_query_name") or "api_key")
            params[key_name] = str(api_key)
            return headers, params, None

        # Default: API key header.
        api_key = config.get_credential("api_key")
        if not api_key:
            return headers, params, "Missing tenant credential `api_key` for header auth"
        header_name = str(config.get_setting("api_key_header_name") or "X-API-Key")
        headers[header_name] = str(api_key)
        return headers, params, None


ConnectorRegistry.register("commercial_premium", CommercialPremiumConnector)

