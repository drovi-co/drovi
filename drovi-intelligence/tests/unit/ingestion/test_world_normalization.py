from __future__ import annotations

import pytest

from src.ingestion.world_normalization import (
    infer_source_family,
    normalize_world_source_payload,
)


pytestmark = [pytest.mark.unit]


def test_infer_source_family_prefers_connector_mapping() -> None:
    family = infer_source_family(
        source_type="news_api",
        connector_type="worldnewsapi",
        source_metadata={"source_key": "worldnewsapi"},
    )
    assert family == "news"


def test_normalize_world_source_payload_news() -> None:
    normalized = normalize_world_source_payload(
        source_type="news_api",
        connector_type="worldnewsapi",
        source_metadata={"source_key": "worldnewsapi"},
        payload={
            "title": "Semiconductor export controls tighten",
            "summary": "Governments introduced tighter controls this week.",
            "url": "https://example.com/news/1",
            "publish_date": "2026-02-23T10:00:00Z",
        },
    )

    assert normalized is not None
    assert normalized.family == "news"
    assert "Headline: Semiconductor export controls tighten" in normalized.content
    assert normalized.metadata["url"] == "https://example.com/news/1"


def test_normalize_world_source_payload_macro() -> None:
    normalized = normalize_world_source_payload(
        source_type="api",
        connector_type="fred",
        source_metadata={"source_key": "fred"},
        payload={
            "series_id": "DFF",
            "series_name": "Effective Federal Funds Rate",
            "value": "5.25",
            "units": "Percent",
            "date": "2026-02-20",
        },
    )

    assert normalized is not None
    assert normalized.family == "macro"
    assert "Macro series: Effective Federal Funds Rate" in normalized.content
    assert normalized.metadata["series_id"] == "DFF"
