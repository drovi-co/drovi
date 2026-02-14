from __future__ import annotations

import hashlib
import unicodedata


def sha256_hexdigest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_text_for_hash(text: str) -> str:
    """Normalize text to make hashing deterministic across trivial variations.

    We apply:
    - strip() to avoid leading/trailing whitespace affecting hashes
    - Unicode NFKC normalization to avoid visually identical variants hashing differently
    """
    stripped = text.strip()
    return unicodedata.normalize("NFKC", stripped)


def build_source_fingerprint(*parts: str | None) -> str:
    """Build a stable fingerprint from ordered source components."""
    normalized = [part or "" for part in parts]
    return "|".join(normalized)


def build_content_hash(content: str, source_fingerprint: str) -> str:
    """Hash content with a source fingerprint for per-source dedupe."""
    payload = f"{source_fingerprint}::{content}".encode("utf-8", errors="ignore")
    return sha256_hexdigest(payload)


def build_segment_hash(text: str) -> str:
    """Hash evidence text for segment-level linking."""
    payload = normalize_text_for_hash(text).encode("utf-8", errors="ignore")
    return sha256_hexdigest(payload)


def build_idempotency_key(*parts: str) -> str:
    """Create an idempotency key from ordered parts."""
    joined = "||".join(parts).encode("utf-8", errors="ignore")
    return sha256_hexdigest(joined)

