"""
CISA Known Exploited Vulnerabilities connector.
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
from src.connectors.sources.world.cisa_kev_definition import CAPABILITIES, default_streams


class CisaKevConnector(BaseConnector):
    """Connector for CISA KEV JSON feed."""

    connector_type = "cisa_kev"
    capabilities = CAPABILITIES

    FEED_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=self.FEED_URL,
                    operation="check_connection",
                )
            if response.status_code >= 400:
                return False, f"CISA KEV returned status {response.status_code}"
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("vulnerabilities"), list):
                return False, "Unexpected CISA KEV payload shape"
            return True, None
        except Exception as exc:
            return False, f"CISA KEV connection failed: {exc}"

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
        if stream.stream_name != "vulnerabilities":
            raise ValueError(f"Unknown stream for cisa_kev: {stream.stream_name}")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = str(cursor.get("date_added") or "")
        batch_size = max(1, int(stream.batch_size or 200))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        emitted = 0
        newest_cursor: str | None = cursor_cutoff or None
        batch = self.create_batch(stream.stream_name, config.connection_id)

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await connector_request(
                connector=self,
                config=config,
                client=client,
                method="GET",
                url=self.FEED_URL,
                operation="read_vulnerabilities",
            )
            response.raise_for_status()
            payload = response.json()
            vulnerabilities = payload.get("vulnerabilities", [])
            if not isinstance(vulnerabilities, list):
                vulnerabilities = []

            for item in vulnerabilities:
                if not isinstance(item, dict):
                    continue

                date_added = str(item.get("dateAdded") or "")
                if (
                    stream.sync_mode == SyncMode.INCREMENTAL
                    and cursor_cutoff
                    and date_added
                    and date_added <= cursor_cutoff
                ):
                    continue

                normalized = self._normalize_vulnerability(item, payload)
                cve_id = str(normalized.get("cve_id") or "")
                record_id = cve_id or f"kev:{date_added}:{emitted}"

                record = self.create_record(
                    record_id=record_id,
                    stream_name=stream.stream_name,
                    data=normalized,
                    cursor_value=date_added or None,
                    record_type=RecordType.CUSTOM,
                )
                batch.add_record(record)
                emitted += 1

                if date_added and (newest_cursor is None or date_added > newest_cursor):
                    newest_cursor = date_added

                if len(batch.records) >= batch_size:
                    next_cursor = {"date_added": newest_cursor} if newest_cursor else None
                    batch.complete(next_cursor=next_cursor, has_more=True)
                    yield batch
                    batch = self.create_batch(stream.stream_name, config.connection_id)

                if max_records_int is not None and emitted >= max_records_int:
                    break

        if batch.records:
            next_cursor = {"date_added": newest_cursor} if newest_cursor else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _normalize_vulnerability(
        self,
        item: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "catalog_version": payload.get("catalogVersion"),
            "date_released": payload.get("dateReleased"),
            "cve_id": item.get("cveID"),
            "vendor_project": item.get("vendorProject"),
            "product": item.get("product"),
            "vulnerability_name": item.get("vulnerabilityName"),
            "date_added": item.get("dateAdded"),
            "short_description": item.get("shortDescription"),
            "required_action": item.get("requiredAction"),
            "due_date": item.get("dueDate"),
            "known_ransomware_campaign_use": item.get("knownRansomwareCampaignUse"),
            "notes": item.get("notes"),
            "cwes": item.get("cwes"),
        }


ConnectorRegistry.register("cisa_kev", CisaKevConnector)

