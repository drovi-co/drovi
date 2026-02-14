from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


def row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


def normalize_domain(value: str) -> str:
    domain = value.strip().lower()
    if "://" in domain:
        parsed = urlparse(domain)
        return (parsed.hostname or "").strip().lower()
    if "/" in domain:
        domain = domain.split("/", 1)[0]
    if ":" in domain:
        domain = domain.split(":", 1)[0]
    return domain


def extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        if parsed.hostname:
            return parsed.hostname.lower()
    except Exception:
        return None
    return None
