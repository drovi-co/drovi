from __future__ import annotations

from datetime import datetime, timezone

UTC = timezone.utc


def utc_now() -> datetime:
    """Return a tz-aware UTC timestamp.

    Preferred internal representation for new code.
    """
    return datetime.now(UTC)


def utc_now_naive() -> datetime:
    """Return a naive UTC timestamp.

    Use only at boundaries that still expect `timestamp without time zone`
    (legacy tables / raw SQL). Domain and application code should use `utc_now()`.
    """
    return utc_now().replace(tzinfo=None)


def is_tz_aware(value: datetime) -> bool:
    """True if a datetime is timezone-aware (has a non-None UTC offset)."""
    return value.tzinfo is not None and value.utcoffset() is not None


def assert_tz_aware(value: datetime, *, name: str = "value") -> datetime:
    """Raise if a datetime is naive.

    This is intentionally strict so we catch bugs early.
    """
    if not is_tz_aware(value):
        raise ValueError(f"{name} must be timezone-aware (got naive datetime)")
    return value


def coerce_utc(value: datetime, *, assume_naive_is_utc: bool = True) -> datetime:
    """Coerce any datetime to tz-aware UTC.

    Adapters may call this when receiving datetimes from untyped boundaries.
    """
    if is_tz_aware(value):
        return value.astimezone(UTC)

    if not assume_naive_is_utc:
        raise ValueError("Naive datetime cannot be coerced without an explicit assumption")

    return value.replace(tzinfo=UTC)


def isoformat_z(value: datetime) -> str:
    """RFC3339-ish UTC string with a `Z` suffix."""
    dt = coerce_utc(value)
    return dt.isoformat().replace("+00:00", "Z")


def parse_iso8601(value: str) -> datetime:
    """Parse ISO8601/RFC3339 timestamps into tz-aware UTC datetimes.

    Supports `Z` suffix.
    """
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    dt = datetime.fromisoformat(normalized)
    return coerce_utc(dt, assume_naive_is_utc=False)

