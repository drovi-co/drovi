from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig

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


def _response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


async def test_sec_edgar_reads_filings() -> None:
    from src.connectors.sources.world.sec_edgar import SecEdgarConnector

    connector = SecEdgarConnector()
    config = _config("sec_edgar", settings={"ciks": ["320193"]})
    stream = (await connector.discover_streams(config))[0]

    payload = {
        "cik": "320193",
        "name": "Apple Inc.",
        "tickers": ["AAPL"],
        "filings": {
            "recent": {
                "form": ["8-K"],
                "accessionNumber": ["0000320193-24-000001"],
                "primaryDocument": ["aapl-8k.htm"],
                "filingDate": ["2026-02-01"],
                "reportDate": ["2026-02-01"],
                "acceptanceDateTime": ["20260201153000"],
                "fileNumber": ["001-36743"],
                "filmNumber": ["123456789"],
                "items": ["5.02"],
                "size": [123456],
                "isXBRL": [1],
                "isInlineXBRL": [0],
            }
        },
    }

    with patch(
        "src.connectors.sources.world.sec_edgar.connector_request",
        new=AsyncMock(return_value=_response(payload)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    record = batches[0].records[0]
    assert record.record_id.startswith("0000320193")
    assert record.data["form_type"] == "8-K"
    assert record.data["ticker"] == "AAPL"
    assert record.record_type.value == "custom"


async def test_federal_register_reads_documents() -> None:
    from src.connectors.sources.world.federal_register import FederalRegisterConnector

    connector = FederalRegisterConnector()
    config = _config("federal_register", settings={"max_pages": 1})
    stream = (await connector.discover_streams(config))[0]

    payload = {
        "total_pages": 1,
        "results": [
            {
                "id": 111,
                "document_number": "2026-12345",
                "title": "Test Rule",
                "type": "Rule",
                "publication_date": "2026-02-20",
                "agency_names": ["Department of Testing"],
                "abstract": "Summary",
                "html_url": "https://federalregister.gov/a",
                "pdf_url": "https://federalregister.gov/a.pdf",
            }
        ],
    }

    with patch(
        "src.connectors.sources.world.federal_register.connector_request",
        new=AsyncMock(return_value=_response(payload)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    record = batches[0].records[0]
    assert record.record_id == "2026-12345"
    assert record.data["type"] == "Rule"
    assert record.data["publication_date"] == "2026-02-20"


async def test_fred_requires_key_and_reads_observations() -> None:
    from src.connectors.sources.world.fred import FredConnector

    connector = FredConnector()
    no_key_config = _config("fred", settings={"series_ids": ["UNRATE"]})
    ok, error = await connector.check_connection(no_key_config)
    assert ok is False
    assert "Missing FRED API key" in (error or "")

    config = _config(
        "fred",
        settings={"series_ids": ["UNRATE"]},
        credentials={"api_key": "fred_test_key"},
    )
    stream = (await connector.discover_streams(config))[0]
    payload = {
        "title": "Unemployment Rate",
        "units": "Percent",
        "frequency": "Monthly",
        "observations": [
            {
                "realtime_start": "2026-02-01",
                "realtime_end": "2026-02-01",
                "date": "2026-01-01",
                "value": "4.1",
            }
        ],
    }

    with patch(
        "src.connectors.sources.world.fred.connector_request",
        new=AsyncMock(return_value=_response(payload)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    record = batches[0].records[0]
    assert record.record_id == "UNRATE:2026-01-01"
    assert record.data["series_id"] == "UNRATE"
    assert record.data["value"] == "4.1"


async def test_crossref_reads_works_with_index_cursor() -> None:
    from src.connectors.sources.world.crossref import CrossrefConnector

    connector = CrossrefConnector()
    config = _config("crossref", settings={"max_pages": 1})
    stream = (await connector.discover_streams(config))[0]

    payload = {
        "message": {
            "next-cursor": "next_cursor_token",
            "items": [
                {
                    "DOI": "10.1000/test-doi",
                    "title": ["A test paper"],
                    "URL": "https://doi.org/10.1000/test-doi",
                    "type": "journal-article",
                    "publisher": "Test Publisher",
                    "container-title": ["Journal of Tests"],
                    "subject": ["AI"],
                    "author": [{"given": "Ada", "family": "Lovelace"}],
                    "indexed": {"date-time": "2026-02-20T10:00:00Z"},
                    "published": {"date-parts": [[2026, 2, 20]]},
                    "created": {"date-time": "2026-02-19T08:00:00Z"},
                    "is-referenced-by-count": 10,
                    "score": 1.0,
                }
            ],
        }
    }

    with patch(
        "src.connectors.sources.world.crossref.connector_request",
        new=AsyncMock(return_value=_response(payload)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    assert batches[0].next_cursor == {"indexed_at": "2026-02-20T10:00:00Z"}
    record = batches[0].records[0]
    assert record.record_id == "10.1000/test-doi"
    assert record.data["authors"] == ["Ada Lovelace"]


async def test_cisa_kev_reads_vulnerabilities() -> None:
    from src.connectors.sources.world.cisa_kev import CisaKevConnector

    connector = CisaKevConnector()
    config = _config("cisa_kev")
    stream = (await connector.discover_streams(config))[0]

    payload = {
        "catalogVersion": "2026.02.20",
        "dateReleased": "2026-02-20T00:00:00Z",
        "vulnerabilities": [
            {
                "cveID": "CVE-2026-0001",
                "vendorProject": "Example Corp",
                "product": "Example Product",
                "vulnerabilityName": "Example vuln",
                "dateAdded": "2026-02-20",
                "shortDescription": "Test",
                "requiredAction": "Patch",
                "dueDate": "2026-03-01",
                "knownRansomwareCampaignUse": "Known",
                "notes": "Critical",
            }
        ],
    }

    with patch(
        "src.connectors.sources.world.cisa_kev.connector_request",
        new=AsyncMock(return_value=_response(payload)),
    ):
        batches = [batch async for batch in connector.read_stream(config, stream, None)]

    assert len(batches) == 1
    assert batches[0].record_count == 1
    assert batches[0].next_cursor == {"date_added": "2026-02-20"}
    record = batches[0].records[0]
    assert record.record_id == "CVE-2026-0001"
    assert record.data["required_action"] == "Patch"

