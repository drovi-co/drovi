"""
Unified Event helpers.

Centralizes hashing and metadata helpers so all ingestion paths
produce consistent Unified Event records.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any


def build_source_fingerprint(*parts: str | None) -> str:
    """Build a stable fingerprint from ordered source components."""
    normalized = [part or "" for part in parts]
    return "|".join(normalized)


def build_content_hash(content: str, source_fingerprint: str) -> str:
    """Hash content with a source fingerprint for per-source dedupe."""
    payload = f"{source_fingerprint}::{content}".encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()


def build_segment_hash(text: str) -> str:
    """Hash evidence text for segment-level linking."""
    payload = text.strip().encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()


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
