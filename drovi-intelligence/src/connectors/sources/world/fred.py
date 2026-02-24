"""
FRED connector.

Ingests macroeconomic time series observations (rates, labor, GDP, etc.).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx

from src.config import get_settings
from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorRegistry, RecordBatch
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http_client import connector_request
from src.connectors.sources.world.fred_definition import CAPABILITIES, default_streams


class FredConnector(BaseConnector):
    """Connector for Federal Reserve Economic Data (FRED)."""

    connector_type = "fred"
    capabilities = CAPABILITIES

    BASE_URL = "https://api.stlouisfed.org/fred"
    DEFAULT_SERIES = ("FEDFUNDS", "UNRATE", "GDP")

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        api_key = self._resolve_api_key(config)
        if not api_key:
            return False, "Missing FRED API key (provider_config.credentials.api_key or FRED_API_KEY)"

        params = {
            "series_id": self._resolve_series_ids(config)[0],
            "api_key": api_key,
            "file_type": "json",
            "limit": 1,
            "sort_order": "desc",
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=f"{self.BASE_URL}/series/observations",
                    operation="check_connection",
                    params=params,
                )
            if response.status_code >= 400:
                return False, f"FRED returned status {response.status_code}"
            payload = response.json()
            if not isinstance(payload, dict):
                return False, "Unexpected FRED payload shape"
            return True, None
        except Exception as exc:
            return False, f"FRED connection failed: {exc}"

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
        if stream.stream_name != "series_observations":
            raise ValueError(f"Unknown stream for fred: {stream.stream_name}")

        api_key = self._resolve_api_key(config)
        if not api_key:
            raise ValueError("Missing FRED API key")

        cursor = (state.get_cursor(stream.stream_name) if state else {}) or {}
        cursor_cutoff = str(cursor.get("observation_date") or "")

        series_ids = self._resolve_series_ids(config)
        batch_size = max(1, int(stream.batch_size or 200))
        max_records = config.get_setting("max_records")
        max_records_int = int(max_records) if max_records is not None else None

        emitted = 0
        newest_cursor: str | None = cursor_cutoff or None
        batch = self.create_batch(stream.stream_name, config.connection_id)

        async with httpx.AsyncClient(timeout=45.0) as client:
            for series_id in series_ids:
                params = {
                    "series_id": series_id,
                    "api_key": api_key,
                    "file_type": "json",
                    "sort_order": "asc",
                    "limit": max(1, min(batch_size, 100000)),
                }
                if cursor_cutoff and stream.sync_mode == SyncMode.INCREMENTAL:
                    params["observation_start"] = cursor_cutoff
                else:
                    start = config.get_setting("observation_start")
                    if start:
                        params["observation_start"] = str(start)

                observation_end = config.get_setting("observation_end")
                if observation_end:
                    params["observation_end"] = str(observation_end)

                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=f"{self.BASE_URL}/series/observations",
                    operation="read_observations",
                    params=params,
                )
                response.raise_for_status()
                payload = response.json()
                observations = payload.get("observations", [])
                if not isinstance(observations, list):
                    continue

                for item in observations:
                    if not isinstance(item, dict):
                        continue
                    obs_date = str(item.get("date") or "")
                    if (
                        stream.sync_mode == SyncMode.INCREMENTAL
                        and cursor_cutoff
                        and obs_date
                        and obs_date <= cursor_cutoff
                    ):
                        continue

                    normalized = {
                        "series_id": series_id,
                        "date": item.get("date"),
                        "value": item.get("value"),
                        "realtime_start": item.get("realtime_start"),
                        "realtime_end": item.get("realtime_end"),
                        "units": payload.get("units"),
                        "title": payload.get("title"),
                        "seasonal_adjustment": payload.get("seasonal_adjustment"),
                        "frequency": payload.get("frequency"),
                    }
                    record_id = f"{series_id}:{item.get('date')}"
                    record = self.create_record(
                        record_id=record_id,
                        stream_name=stream.stream_name,
                        data=normalized,
                        cursor_value=obs_date or None,
                        record_type=RecordType.CUSTOM,
                    )
                    batch.add_record(record)
                    emitted += 1

                    if obs_date and (newest_cursor is None or obs_date > newest_cursor):
                        newest_cursor = obs_date

                    if len(batch.records) >= batch_size:
                        next_cursor = {"observation_date": newest_cursor} if newest_cursor else None
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                    if max_records_int is not None and emitted >= max_records_int:
                        break

                if max_records_int is not None and emitted >= max_records_int:
                    break

        if batch.records:
            next_cursor = {"observation_date": newest_cursor} if newest_cursor else None
            batch.complete(next_cursor=next_cursor, has_more=False)
            yield batch

    def _resolve_api_key(self, config: ConnectorConfig) -> str | None:
        return (
            config.get_credential("api_key")
            or config.get_setting("api_key")
            or get_settings().fred_api_key
        )

    def _resolve_series_ids(self, config: ConnectorConfig) -> list[str]:
        raw = config.get_setting("series_ids", list(self.DEFAULT_SERIES))
        if isinstance(raw, str):
            raw = [segment.strip() for segment in raw.split(",") if segment.strip()]
        if not isinstance(raw, list) or not raw:
            return list(self.DEFAULT_SERIES)
        values = [str(series).strip() for series in raw if str(series).strip()]
        return values or list(self.DEFAULT_SERIES)


ConnectorRegistry.register("fred", FredConnector)

