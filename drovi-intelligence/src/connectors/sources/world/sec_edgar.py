"""
SEC EDGAR connector.

Ingests filing updates from SEC submission JSON endpoints scoped by CIK watchlists.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http_client import connector_request
from src.connectors.sources.world.sec_edgar_definition import CAPABILITIES, default_streams

logger = structlog.get_logger()


class SecEdgarConnector(BaseConnector):
    """Connector for SEC EDGAR submissions."""

    connector_type = "sec_edgar"
    capabilities = CAPABILITIES

    BASE_URL = "https://data.sec.gov"
    DEFAULT_TEST_CIK = "0000320193"  # Apple Inc.
    DEFAULT_USER_AGENT = "Drovi Intelligence/1.0 (support@drovi.co)"

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        cik = self._resolve_ciks(config)[0] if self._resolve_ciks(config) else self.DEFAULT_TEST_CIK
        url = f"{self.BASE_URL}/submissions/CIK{self._normalize_cik(cik)}.json"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="check_connection",
                    headers=self._build_headers(config),
                )

            if response.status_code >= 400:
                return False, f"SEC EDGAR returned status {response.status_code}"

            payload = response.json()
            if not isinstance(payload, dict):
                return False, "Unexpected SEC EDGAR payload shape"
            return True, None
        except Exception as exc:
            return False, f"SEC EDGAR connection failed: {exc}"

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
        if stream.stream_name != "filings":
            raise ValueError(f"Unknown stream for sec_edgar: {stream.stream_name}")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = str(cursor.get("acceptance_datetime") or "")
        ciks = self._resolve_ciks(config)
        if not ciks:
            logger.warning(
                "No CIK watchlist configured for SEC EDGAR connector",
                connection_id=config.connection_id,
            )
            return

        batch_size = max(1, int(stream.batch_size or 100))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        batch = self.create_batch(stream.stream_name, config.connection_id)
        newest_cursor: str | None = cursor_cutoff or None
        emitted = 0

        async with httpx.AsyncClient(timeout=45.0) as client:
            for cik_raw in ciks:
                cik = self._normalize_cik(cik_raw)
                url = f"{self.BASE_URL}/submissions/CIK{cik}.json"
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="read_filings",
                    headers=self._build_headers(config),
                )
                response.raise_for_status()
                payload = response.json()

                for filing in self._iter_recent_filings(payload):
                    acceptance_dt = str(filing.get("acceptance_datetime") or "")
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff
                        and acceptance_dt
                        and acceptance_dt <= cursor_cutoff
                    ):
                        continue

                    record_id = f"{cik}:{filing.get('accession_number') or filing.get('filing_date')}"
                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=filing,
                        cursor_value=acceptance_dt or filing.get("filing_date"),
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if acceptance_dt and (newest_cursor is None or acceptance_dt > newest_cursor):
                        newest_cursor = acceptance_dt

                    if len(batch.records) >= batch_size:
                        next_cursor = (
                            {"acceptance_datetime": newest_cursor} if newest_cursor else None
                        )
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

        if batch.records:
            next_cursor = {"acceptance_datetime": newest_cursor} if newest_cursor else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _build_headers(self, config: ConnectorConfig) -> dict[str, str]:
        configured_user_agent = (
            config.get_setting("user_agent")
            or config.get_credential("user_agent")
            or self.DEFAULT_USER_AGENT
        )
        return {
            "User-Agent": str(configured_user_agent),
            "Accept": "application/json",
        }

    def _resolve_ciks(self, config: ConnectorConfig) -> list[str]:
        ciks = config.get_setting("ciks", [])
        if isinstance(ciks, str):
            ciks = [c.strip() for c in ciks.split(",") if c.strip()]
        if not isinstance(ciks, list):
            return []
        return [str(cik).strip() for cik in ciks if str(cik).strip()]

    def _normalize_cik(self, cik: str) -> str:
        digits = "".join(ch for ch in str(cik) if ch.isdigit())
        if not digits:
            return self.DEFAULT_TEST_CIK
        return digits.zfill(10)

    def _iter_recent_filings(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        filings = payload.get("filings", {})
        recent = filings.get("recent", {}) if isinstance(filings, dict) else {}
        if not isinstance(recent, dict):
            return []

        forms = self._as_list(recent.get("form"))
        accession_numbers = self._as_list(recent.get("accessionNumber"))
        primary_documents = self._as_list(recent.get("primaryDocument"))
        filing_dates = self._as_list(recent.get("filingDate"))
        report_dates = self._as_list(recent.get("reportDate"))
        acceptance_datetimes = self._as_list(recent.get("acceptanceDateTime"))
        file_numbers = self._as_list(recent.get("fileNumber"))
        film_numbers = self._as_list(recent.get("filmNumber"))
        items = self._as_list(recent.get("items"))
        sizes = self._as_list(recent.get("size"))
        is_xbrl = self._as_list(recent.get("isXBRL"))
        is_inline_xbrl = self._as_list(recent.get("isInlineXBRL"))

        cik = str(payload.get("cik") or "").zfill(10)
        cik_without_zeros = str(payload.get("cik") or "")
        company_name = payload.get("name")
        sic = payload.get("sic")
        sic_description = payload.get("sicDescription")
        ticker = None
        tickers = payload.get("tickers")
        if isinstance(tickers, list) and tickers:
            ticker = tickers[0]

        results: list[dict[str, Any]] = []
        for idx in range(len(forms)):
            accession = str(accession_numbers[idx]) if idx < len(accession_numbers) else None
            filing_date = str(filing_dates[idx]) if idx < len(filing_dates) else None
            acceptance_dt_raw = (
                str(acceptance_datetimes[idx]) if idx < len(acceptance_datetimes) else None
            )
            acceptance_datetime = self._to_iso_datetime(acceptance_dt_raw)
            primary_document = (
                str(primary_documents[idx]) if idx < len(primary_documents) else None
            )
            filing_url = None
            if accession and primary_document and cik_without_zeros:
                accession_nodash = accession.replace("-", "")
                filing_url = (
                    "https://www.sec.gov/Archives/edgar/data/"
                    f"{cik_without_zeros}/{accession_nodash}/{primary_document}"
                )

            results.append(
                {
                    "cik": cik,
                    "company_name": company_name,
                    "ticker": ticker,
                    "sic": sic,
                    "sic_description": sic_description,
                    "form_type": str(forms[idx]) if idx < len(forms) else None,
                    "accession_number": accession,
                    "filing_date": filing_date,
                    "report_date": str(report_dates[idx]) if idx < len(report_dates) else None,
                    "acceptance_datetime": acceptance_datetime or acceptance_dt_raw,
                    "primary_document": primary_document,
                    "file_number": str(file_numbers[idx]) if idx < len(file_numbers) else None,
                    "film_number": str(film_numbers[idx]) if idx < len(film_numbers) else None,
                    "items": str(items[idx]) if idx < len(items) else None,
                    "size": sizes[idx] if idx < len(sizes) else None,
                    "is_xbrl": bool(is_xbrl[idx]) if idx < len(is_xbrl) else None,
                    "is_inline_xbrl": bool(is_inline_xbrl[idx]) if idx < len(is_inline_xbrl) else None,
                    "filing_url": filing_url,
                }
            )
        return results

    def _as_list(self, value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        return []

    def _to_iso_datetime(self, value: str | None) -> str | None:
        if not value:
            return None
        raw = value.strip()
        if not raw:
            return None

        if raw.endswith("Z"):
            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).isoformat()
            except ValueError:
                return raw

        if len(raw) == 14 and raw.isdigit():
            # EDGAR often emits format YYYYMMDDHHMMSS.
            try:
                dt = datetime.strptime(raw, "%Y%m%d%H%M%S")  # noqa: DTZ007
                return dt.isoformat()
            except ValueError:
                return raw

        try:
            return datetime.fromisoformat(raw).isoformat()
        except ValueError:
            return raw


ConnectorRegistry.register("sec_edgar", SecEdgarConnector)

