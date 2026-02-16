from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src.kernel.serialization import json_dumps_canonical, to_jsonable


@pytest.mark.unit
def test_to_jsonable_handles_datetime():
    dt = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    assert to_jsonable(dt) == "2026-02-10T12:00:00+00:00"


@pytest.mark.unit
def test_to_jsonable_handles_decimal_as_string():
    assert to_jsonable(Decimal("10.50")) == "10.50"


@pytest.mark.unit
def test_json_dumps_canonical_sorts_keys_and_is_compact():
    payload = {"b": 1, "a": 2}
    assert json_dumps_canonical(payload) == '{"a":2,"b":1}'

