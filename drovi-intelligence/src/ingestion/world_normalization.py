"""Canonical normalization adapters for external world-source families."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.connectors.source_catalog import get_source_catalog
from src.kernel.text import sanitize_extraction_text


_FAMILY_BY_SOURCE_KEY: dict[str, str] = {
    "sec_edgar": "regulatory",
    "federal_register": "regulatory",
    "fred": "macro",
    "crossref": "research",
    "cisa_kev": "vulnerability",
    "worldnewsapi": "news",
    "rss_osint": "news",
    "commercial_premium": "news",
    "crawler": "news",
}


@dataclass(frozen=True)
class CanonicalWorldNormalization:
    family: str
    content: str
    subject: str | None
    entities: list[str]
    metadata: dict[str, Any]


def _text(value: Any, *, limit: int = 5000) -> str:
    return sanitize_extraction_text(str(value or ""), max_length=limit) or ""


def _first(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload.get(key) not in (None, ""):
            return payload.get(key)
    return None


def infer_source_family(
    *,
    source_type: str | None,
    connector_type: str | None,
    source_metadata: dict[str, Any] | None,
) -> str:
    meta = dict(source_metadata or {})
    candidates = [
        str(meta.get("source_key") or "").strip().lower(),
        str(meta.get("connector_type") or "").strip().lower(),
        str(connector_type or "").strip().lower(),
        str(source_type or "").strip().lower(),
    ]
    for candidate in candidates:
        if candidate in _FAMILY_BY_SOURCE_KEY:
            return _FAMILY_BY_SOURCE_KEY[candidate]

    try:
        catalog = get_source_catalog()
        by_key = {entry.source_key: entry for entry in catalog.sources}
        for candidate in candidates:
            if candidate and candidate in by_key:
                entry = by_key[candidate]
                provider_type = str(entry.provider_type or "").lower()
                tags = {str(tag).lower() for tag in entry.tags}
                if "news" in provider_type or "news" in tags or "world-events" in tags:
                    return "news"
                if "regulatory" in provider_type or "regulation" in tags:
                    return "regulatory"
                if "macro" in provider_type or "macro" in tags:
                    return "macro"
                if "research" in provider_type or "research" in tags:
                    return "research"
                if "vulnerability" in provider_type or "vulnerability" in tags:
                    return "vulnerability"
    except Exception:
        pass

    return "generic"


def _normalize_news(payload: dict[str, Any]) -> CanonicalWorldNormalization | None:
    title = _text(_first(payload, "title", "headline", "name"), limit=500)
    summary = _text(_first(payload, "summary", "text", "content", "description"), limit=24000)
    published_at = _first(payload, "publish_date", "published_at", "published", "date")
    source_name = _first(payload, "source_name", "source", "news_site")
    url = _first(payload, "url", "link", "source_url")
    entities = [str(item) for item in (payload.get("entities") or payload.get("tickers") or []) if item]

    parts: list[str] = []
    if title:
        parts.append(f"Headline: {title}")
    if summary:
        parts.append(summary)
    if source_name:
        parts.append(f"Source: {source_name}")
    if published_at:
        parts.append(f"Published: {published_at}")
    if url:
        parts.append(f"URL: {url}")
    content = "\n\n".join(parts).strip()
    if not content:
        return None
    return CanonicalWorldNormalization(
        family="news",
        content=content,
        subject=title or None,
        entities=entities,
        metadata={
            "url": url,
            "published_at": str(published_at) if published_at is not None else None,
            "source_name": str(source_name) if source_name is not None else None,
        },
    )


def _normalize_regulatory(payload: dict[str, Any]) -> CanonicalWorldNormalization | None:
    title = _text(
        _first(payload, "title", "rule_title", "document_title", "filing_title"),
        limit=500,
    )
    summary = _text(_first(payload, "summary", "abstract", "description", "text"), limit=24000)
    authority = _first(payload, "agency", "regulator", "authority", "jurisdiction")
    identifier = _first(payload, "document_number", "accession_id", "cik", "rule_id", "filing_id")
    effective_date = _first(payload, "effective_date", "publication_date", "filing_date", "date")

    parts: list[str] = []
    if title:
        parts.append(f"Regulatory item: {title}")
    if summary:
        parts.append(summary)
    if authority:
        parts.append(f"Authority: {authority}")
    if identifier:
        parts.append(f"Identifier: {identifier}")
    if effective_date:
        parts.append(f"Effective/Published: {effective_date}")
    content = "\n\n".join(parts).strip()
    if not content:
        return None
    return CanonicalWorldNormalization(
        family="regulatory",
        content=content,
        subject=title or None,
        entities=[str(identifier)] if identifier else [],
        metadata={
            "authority": str(authority) if authority is not None else None,
            "identifier": str(identifier) if identifier is not None else None,
            "effective_date": str(effective_date) if effective_date is not None else None,
        },
    )


def _normalize_macro(payload: dict[str, Any]) -> CanonicalWorldNormalization | None:
    series_id = _first(payload, "series_id", "seriesId", "id")
    series_name = _first(payload, "series_name", "title", "name")
    value = _first(payload, "value", "observation_value", "latest_value")
    date_value = _first(payload, "date", "observation_date", "release_date")
    units = _first(payload, "units", "unit", "unit_short")
    frequency = _first(payload, "frequency", "frequency_short")

    parts: list[str] = []
    if series_name or series_id:
        parts.append(f"Macro series: {series_name or series_id}")
    if value is not None:
        if units:
            parts.append(f"Value: {value} {units}")
        else:
            parts.append(f"Value: {value}")
    if date_value:
        parts.append(f"Date: {date_value}")
    if frequency:
        parts.append(f"Frequency: {frequency}")
    content = "\n\n".join(parts).strip()
    if not content:
        return None
    return CanonicalWorldNormalization(
        family="macro",
        content=content,
        subject=_text(series_name or series_id, limit=500) or None,
        entities=[str(series_id)] if series_id else [],
        metadata={
            "series_id": str(series_id) if series_id is not None else None,
            "date": str(date_value) if date_value is not None else None,
            "units": str(units) if units is not None else None,
        },
    )


def _normalize_research(payload: dict[str, Any]) -> CanonicalWorldNormalization | None:
    title = _text(_first(payload, "title", "paper_title", "name"), limit=500)
    abstract = _text(_first(payload, "abstract", "summary", "description"), limit=24000)
    doi = _first(payload, "doi")
    journal = _first(payload, "journal", "publisher")
    publication_date = _first(payload, "published_at", "publication_date", "date")

    parts: list[str] = []
    if title:
        parts.append(f"Research: {title}")
    if abstract:
        parts.append(abstract)
    if doi:
        parts.append(f"DOI: {doi}")
    if journal:
        parts.append(f"Journal/Publisher: {journal}")
    if publication_date:
        parts.append(f"Published: {publication_date}")
    content = "\n\n".join(parts).strip()
    if not content:
        return None
    return CanonicalWorldNormalization(
        family="research",
        content=content,
        subject=title or None,
        entities=[str(doi)] if doi else [],
        metadata={
            "doi": str(doi) if doi is not None else None,
            "journal": str(journal) if journal is not None else None,
            "publication_date": str(publication_date) if publication_date is not None else None,
        },
    )


def _normalize_vulnerability(payload: dict[str, Any]) -> CanonicalWorldNormalization | None:
    cve_id = _first(payload, "cve", "cve_id", "id")
    title = _text(_first(payload, "title", "name"), limit=500)
    summary = _text(_first(payload, "summary", "description", "notes"), limit=24000)
    severity = _first(payload, "severity", "cvss", "cvss_score")
    due_date = _first(payload, "due_date", "deadline", "date_due")
    vendor = _first(payload, "vendor")
    product = _first(payload, "product")

    parts: list[str] = []
    if cve_id:
        parts.append(f"Vulnerability: {cve_id}")
    if title:
        parts.append(f"Title: {title}")
    if summary:
        parts.append(summary)
    if severity is not None:
        parts.append(f"Severity: {severity}")
    if vendor or product:
        parts.append(f"Affected: {vendor or 'unknown vendor'} / {product or 'unknown product'}")
    if due_date:
        parts.append(f"Remediation deadline: {due_date}")
    content = "\n\n".join(parts).strip()
    if not content:
        return None
    return CanonicalWorldNormalization(
        family="vulnerability",
        content=content,
        subject=(str(cve_id) if cve_id else title or None),
        entities=[str(cve_id)] if cve_id else [],
        metadata={
            "cve_id": str(cve_id) if cve_id is not None else None,
            "severity": str(severity) if severity is not None else None,
            "due_date": str(due_date) if due_date is not None else None,
        },
    )


def normalize_world_source_payload(
    *,
    source_type: str | None,
    connector_type: str | None,
    source_metadata: dict[str, Any] | None,
    payload: dict[str, Any] | None,
) -> CanonicalWorldNormalization | None:
    if not isinstance(payload, dict):
        return None

    family = infer_source_family(
        source_type=source_type,
        connector_type=connector_type,
        source_metadata=source_metadata,
    )
    if family == "news":
        return _normalize_news(payload)
    if family == "regulatory":
        return _normalize_regulatory(payload)
    if family == "macro":
        return _normalize_macro(payload)
    if family == "research":
        return _normalize_research(payload)
    if family == "vulnerability":
        return _normalize_vulnerability(payload)
    return None
