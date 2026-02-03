"""Simple DLP redaction utilities for transcripts and evidence."""

from __future__ import annotations

import re

from src.config import get_settings


_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CC_RE = re.compile(r"\b(?:\d[ -]*?){13,16}\b")


def _mask(value: str, mask_char: str) -> str:
    return mask_char * max(len(value), 4)


def sanitize_text(text: str) -> tuple[str, dict[str, int]]:
    """
    Redact common sensitive patterns from text.

    Returns:
        (sanitized_text, redaction_counts)
    """
    settings = get_settings()
    if not settings.dlp_enabled:
        return text, {}

    mask_char = settings.dlp_mask_char or "█"
    redactions: dict[str, int] = {"emails": 0, "phones": 0, "ssn": 0, "cards": 0}

    sanitized = text

    if not settings.dlp_allow_emails:
        sanitized, count = _EMAIL_RE.subn(lambda m: _mask(m.group(0), mask_char), sanitized)
        redactions["emails"] = count

    if not settings.dlp_allow_phone_numbers:
        sanitized, count = _PHONE_RE.subn(lambda m: _mask(m.group(0), mask_char), sanitized)
        redactions["phones"] = count

    sanitized, count = _SSN_RE.subn(lambda m: _mask(m.group(0), mask_char), sanitized)
    redactions["ssn"] = count

    sanitized, count = _CC_RE.subn(lambda m: _mask(m.group(0), mask_char), sanitized)
    redactions["cards"] = count

    return sanitized, redactions
