"""
Unified Event helpers.

Centralizes hashing and metadata helpers so all ingestion paths
produce consistent Unified Event records.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.kernel.hashing import (
    build_content_hash,
    build_segment_hash,
    build_source_fingerprint,
)
from src.kernel.serialization import json_dumps_canonical


def build_event_hash(
    content_text: str | None,
    content_json: dict[str, Any] | list[Any] | None,
    source_fingerprint: str,
) -> str:
    """Hash event payload with a source fingerprint for dedupe."""
    if content_text:
        content = content_text
    elif content_json is not None:
        content = json_dumps_canonical(content_json)
    else:
        content = ""
    return build_content_hash(content, source_fingerprint)


def build_uem_metadata(
    base_metadata: dict[str, Any] | None,
    source_fingerprint: str,
    content_hash: str,
    captured_at: datetime | None,
    received_at: datetime | None,
) -> dict[str, Any]:
    """Attach standard metadata fields to UEM records."""
    metadata = dict(base_metadata or {})
    metadata.setdefault("source_fingerprint", source_fingerprint)
    metadata.setdefault("content_hash", content_hash)
    if captured_at:
        metadata.setdefault("captured_at", captured_at.isoformat())
    if received_at:
        metadata.setdefault("received_at", received_at.isoformat())
    return metadata
