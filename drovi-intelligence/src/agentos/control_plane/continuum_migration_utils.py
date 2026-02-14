from __future__ import annotations

import hashlib
import json
from typing import Any

from src.kernel.serialization import json_dumps_canonical


def decode_json(value: Any, *, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def ratio(expected: float, actual: float) -> float:
    if expected <= 0 and actual <= 0:
        return 1.0
    if expected <= 0 or actual <= 0:
        return 0.0
    return min(expected, actual) / max(expected, actual)


def bounded(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def build_snapshot_hash(
    *,
    role_id: str,
    profile_id: str,
    playbook_id: str,
    rollout_strategy: dict[str, Any],
) -> str:
    payload = {
        "role_id": role_id,
        "profile_id": profile_id,
        "playbook_id": playbook_id,
        "rollout_strategy": rollout_strategy,
    }
    return hashlib.sha256(json_dumps_canonical(payload).encode("utf-8")).hexdigest()
