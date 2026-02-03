"""PII detection utilities for guardrails."""

from __future__ import annotations

import re

from src.config import get_settings
from .schemas import PIIFinding, PIIType, SeverityLevel


_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CC_RE = re.compile(r"\b(?:\d[ -]*?){13,16}\b")


def _mask(value: str, mask_char: str) -> str:
    return mask_char * max(len(value), 4)


def _severity_for_pii(pii_type: PIIType) -> SeverityLevel:
    if pii_type in {"ssn", "credit_card"}:
        return "critical"
    if pii_type in {"email", "phone"}:
        return "medium"
    return "low"


def detect_pii(text: str) -> list[PIIFinding]:
    """Detect PII entities in text and return structured findings."""
    settings = get_settings()
    if not settings.dlp_enabled:
        return []

    mask_char = settings.dlp_mask_char or "█"
    findings: list[PIIFinding] = []

    for match in _EMAIL_RE.finditer(text):
        value = match.group(0)
        findings.append(
            PIIFinding(
                type="email",
                start=match.start(),
                end=match.end(),
                masked_value=_mask(value, mask_char),
                allowed=settings.dlp_allow_emails,
                severity=_severity_for_pii("email"),
            )
        )

    for match in _PHONE_RE.finditer(text):
        value = match.group(0)
        findings.append(
            PIIFinding(
                type="phone",
                start=match.start(),
                end=match.end(),
                masked_value=_mask(value, mask_char),
                allowed=settings.dlp_allow_phone_numbers,
                severity=_severity_for_pii("phone"),
            )
        )

    for match in _SSN_RE.finditer(text):
        value = match.group(0)
        findings.append(
            PIIFinding(
                type="ssn",
                start=match.start(),
                end=match.end(),
                masked_value=_mask(value, mask_char),
                allowed=False,
                severity=_severity_for_pii("ssn"),
            )
        )

    for match in _CC_RE.finditer(text):
        value = match.group(0)
        findings.append(
            PIIFinding(
                type="credit_card",
                start=match.start(),
                end=match.end(),
                masked_value=_mask(value, mask_char),
                allowed=False,
                severity=_severity_for_pii("credit_card"),
            )
        )

    return findings
