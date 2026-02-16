from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.kernel.time import (
    UTC,
    assert_tz_aware,
    coerce_utc,
    isoformat_z,
    is_tz_aware,
    parse_iso8601,
    utc_now,
    utc_now_naive,
)


@pytest.mark.unit
def test_utc_now_is_tz_aware_utc():
    now = utc_now()
    assert is_tz_aware(now)
    assert now.tzinfo is not None
    assert now.utcoffset() == timezone.utc.utcoffset(now)


@pytest.mark.unit
def test_utc_now_naive_is_naive():
    now = utc_now_naive()
    assert isinstance(now, datetime)
    assert now.tzinfo is None


@pytest.mark.unit
def test_isoformat_z_uses_z_suffix():
    dt = datetime(2026, 2, 10, 12, 0, 0, tzinfo=UTC)
    assert isoformat_z(dt).endswith("Z")


@pytest.mark.unit
def test_parse_iso8601_supports_z_suffix():
    parsed = parse_iso8601("2026-02-10T12:00:00Z")
    assert parsed == datetime(2026, 2, 10, 12, 0, 0, tzinfo=UTC)


@pytest.mark.unit
def test_assert_tz_aware_raises_on_naive():
    with pytest.raises(ValueError):
        assert_tz_aware(datetime(2026, 2, 10, 12, 0, 0))


@pytest.mark.unit
def test_coerce_utc_from_aware():
    dt = datetime(2026, 2, 10, 12, 0, 0, tzinfo=UTC)
    assert coerce_utc(dt) == dt

