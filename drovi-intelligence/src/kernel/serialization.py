from __future__ import annotations

import dataclasses
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType
from typing import Any
from uuid import UUID


def to_jsonable(value: Any) -> Any:
    """Coerce common Python types into JSON-compatible primitives.

    This is intentionally explicit (and limited). If you need to serialize
    a new type, add a branch and tests.
    """
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, UUID):
        return str(value)

    if isinstance(value, Decimal):
        # Avoid float rounding surprises; callers can cast if they need numeric.
        return str(value)

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, MappingProxyType):
        return {str(k): to_jsonable(v) for (k, v) in dict(value).items()}

    if dataclasses.is_dataclass(value):
        return {str(k): to_jsonable(v) for (k, v) in dataclasses.asdict(value).items()}

    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for (k, v) in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]

    # Pydantic models (v1/v2) expose model_dump / dict. We support both.
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return to_jsonable(model_dump())

    as_dict = getattr(value, "dict", None)
    if callable(as_dict):
        return to_jsonable(as_dict())

    raise TypeError(f"Unsupported type for JSON serialization: {type(value)!r}")


def json_dumps_canonical(value: Any) -> str:
    """Stable JSON encoding for hashing, caching keys, and logs."""
    return json.dumps(
        to_jsonable(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def json_loads(value: str) -> Any:
    return json.loads(value)

