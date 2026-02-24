"""
Federal Register connector.

Ingests document updates (rules, notices, proposed rules, presidential docs).
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
from src.connectors.sources.world.federal_register_definition import CAPABILITIES, default_streams


class FederalRegisterConnector(BaseConnector):
    """Connector for Federal Register API v1 documents."""

    connector_type = "federal_register"
    capabilities = CAPABILITIES

    DOCUMENTS_URL = "https://www.federalregister.gov/api/v1/documents.json"

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        params = {"per_page": 1, "order": "newest"}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=self.DOCUMENTS_URL,
                    operation="check_connection",
                    params=params,
                )
            if response.status_code >= 400:
                return False, f"Federal Register returned status {response.status_code}"
            payload = response.json()
            if not isinstance(payload, dict):
                return False, "Unexpected Federal Register payload shape"
            return True, None
        except Exception as exc:
            return False, f"Federal Register connection failed: {exc}"

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
        if stream.stream_name != "documents":
            raise ValueError(f"Unknown stream for federal_register: {stream.stream_name}")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = str(cursor.get("publication_date") or "")

        batch_size = max(1, int(stream.batch_size or 100))
        max_pages = int(config.get_setting("max_pages", 5))
        max_pages = max(1, min(max_pages, 200))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        page = 1
        emitted = 0
        newest_cursor: str | None = cursor_cutoff or None
        batch = self.create_batch(stream.stream_name, config.connection_id)

        async with httpx.AsyncClient(timeout=45.0) as client:
            while page <= max_pages:
                params = self._build_params(config, page, stream)
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=self.DOCUMENTS_URL,
                    operation="read_documents",
                    params=params,
                )
                response.raise_for_status()
                payload = response.json()

                results = payload.get("results", [])
                if not isinstance(results, list) or not results:
                    break

                for item in results:
                    if not isinstance(item, dict):
                        continue
                    publication_date = str(item.get("publication_date") or "")
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff
                        and publication_date
                        and publication_date <= cursor_cutoff
                    ):
                        continue

                    normalized = self._normalize_document(item)
                    record_id = (
                        str(normalized.get("document_number"))
                        or str(normalized.get("document_id"))
                        or str(normalized.get("slug"))
                    )
                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=normalized,
                        cursor_value=publication_date or None,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if publication_date and (newest_cursor is None or publication_date > newest_cursor):
                        newest_cursor = publication_date

                    if len(batch.records) >= batch_size:
                        next_cursor = {"publication_date": newest_cursor} if newest_cursor else None
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

                total_pages = payload.get("total_pages")
                if isinstance(total_pages, int) and page >= total_pages:
                    break

                page += 1

        if batch.records:
            next_cursor = {"publication_date": newest_cursor} if newest_cursor else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _build_params(
        self,
        config: ConnectorConfig,
        page: int,
        stream: StreamConfig,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "per_page": max(1, min(int(stream.batch_size or 100), 1000)),
            "order": "newest",
            "page": page,
        }
        agencies = config.get_setting("agencies", [])
        if isinstance(agencies, list) and agencies:
            params["conditions[agencies][]"] = [str(agency) for agency in agencies]

        document_types = config.get_setting("document_types", [])
        if isinstance(document_types, list) and document_types:
            params["conditions[type][]"] = [str(doc_type) for doc_type in document_types]

        topic = config.get_setting("topic")
        if topic:
            params["conditions[term]"] = str(topic)

        publication_start = config.get_setting("publication_date_gte")
        if publication_start:
            params["conditions[publication_date][gte]"] = str(publication_start)

        publication_end = config.get_setting("publication_date_lte")
        if publication_end:
            params["conditions[publication_date][lte]"] = str(publication_end)

        return params

    def _normalize_document(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "document_id": item.get("id"),
            "document_number": item.get("document_number"),
            "title": item.get("title"),
            "type": item.get("type"),
            "publication_date": item.get("publication_date"),
            "agency_names": item.get("agency_names", []),
            "abstract": item.get("abstract"),
            "url": item.get("html_url") or item.get("pdf_url") or item.get("public_inspection_pdf_url"),
            "pdf_url": item.get("pdf_url"),
            "html_url": item.get("html_url"),
            "json_url": item.get("json_url"),
            "raw_text_url": item.get("raw_text_url"),
            "significant": item.get("significant"),
            "topics": item.get("topics", []),
            "regulation_id_numbers": item.get("regulation_id_numbers", []),
            "docket_ids": item.get("docket_ids", []),
            "effective_on": item.get("effective_on"),
            "comments_close_on": item.get("comments_close_on"),
        }


ConnectorRegistry.register("federal_register", FederalRegisterConnector)

