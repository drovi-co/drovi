"""Due date inference helpers.

These helpers provide deterministic fallback parsing when model extraction
returns `due_date_text` but not a normalized datetime value.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, time, timedelta

WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

MONTH_PATTERN = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
    r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
    r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)

EXPLICIT_DATE_PATTERNS = (
    re.compile(
        rf"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)?\s*"
        rf"{MONTH_PATTERN}\s+\d{{1,2}}(?:,\s*\d{{4}})?\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})\b"),
)

RELATIVE_WEEKDAY_PATTERN = re.compile(
    r"\b(?:by|on|before|until|due(?:\s+on)?|next)?\s*"
    r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    re.IGNORECASE,
)


def _normalize_reference(reference_time: datetime | None) -> datetime:
    if reference_time is None:
        return datetime.now(UTC)
    if reference_time.tzinfo is None:
        return reference_time.replace(tzinfo=UTC)
    return reference_time.astimezone(UTC)


def _coerce_year(value: datetime, reference: datetime) -> datetime:
    """If parsed date omitted a year, align with the closest plausible year."""
    if value.year != 1900:
        return value
    candidate = value.replace(year=reference.year)
    # If the inferred date is far in the past, prefer next year.
    if candidate.date() < (reference.date() - timedelta(days=45)):
        return candidate.replace(year=reference.year + 1)
    return candidate


def _parse_explicit_date(text: str, reference: datetime) -> datetime | None:
    for pattern in EXPLICIT_DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        candidate = match.group(0).strip().replace("  ", " ")

        for fmt in (
            "%A %B %d, %Y",
            "%A %b %d, %Y",
            "%B %d, %Y",
            "%b %d, %Y",
            "%A %B %d",
            "%A %b %d",
            "%B %d",
            "%b %d",
            "%m/%d/%Y",
            "%m/%d/%y",
            "%m-%d-%Y",
            "%m-%d-%y",
        ):
            try:
                parsed = datetime.strptime(candidate, fmt)
            except ValueError:
                continue
            parsed = _coerce_year(parsed, reference)
            return parsed.replace(
                hour=reference.hour,
                minute=reference.minute,
                second=reference.second,
                microsecond=0,
                tzinfo=UTC,
            )
    return None


def _parse_relative_keyword(text: str, reference: datetime) -> datetime | None:
    lowered = text.lower()
    if "tomorrow" in lowered:
        return (reference + timedelta(days=1)).replace(microsecond=0)
    if "today" in lowered:
        return reference.replace(microsecond=0)
    if "next week" in lowered:
        return (reference + timedelta(days=7)).replace(microsecond=0)

    weekday_match = RELATIVE_WEEKDAY_PATTERN.search(lowered)
    if weekday_match:
        target = WEEKDAY_INDEX.get(weekday_match.group(1).lower())
        if target is not None:
            delta_days = (target - reference.weekday()) % 7
            delta_days = 7 if delta_days == 0 else delta_days
            return (reference + timedelta(days=delta_days)).replace(microsecond=0)

    return None


def infer_due_date(
    *,
    due_date: datetime | None = None,
    due_date_text: str | None = None,
    title: str | None = None,
    description: str | None = None,
    quoted_text: str | None = None,
    reference_time: datetime | None = None,
) -> datetime | None:
    """Infer a normalized due date from explicit/relative textual cues.

    The output is timezone-aware UTC to simplify downstream storage conversion.
    """
    if due_date is not None:
        if due_date.tzinfo is None:
            return due_date.replace(tzinfo=UTC)
        return due_date.astimezone(UTC)

    reference = _normalize_reference(reference_time)
    candidates = [due_date_text, title, description, quoted_text]

    for raw in candidates:
        text = (raw or "").strip()
        if not text:
            continue

        explicit = _parse_explicit_date(text, reference)
        if explicit is not None:
            return explicit

        relative = _parse_relative_keyword(text, reference)
        if relative is not None:
            return relative

    return None


def coerce_end_of_day(value: datetime) -> datetime:
    """Normalize a date-like value to 17:00 UTC for deadline semantics."""
    return datetime.combine(value.date(), time(hour=17, minute=0), tzinfo=UTC)
