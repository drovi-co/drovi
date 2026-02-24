"""Ingest surge controls for global kill-switches and priority degradation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True, slots=True)
class IngestSurgeDecision:
    priority: int
    drop_event: bool
    throttle_multiplier: float
    reason_codes: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "priority": int(self.priority),
            "drop_event": bool(self.drop_event),
            "throttle_multiplier": round(float(self.throttle_multiplier), 4),
            "reason_codes": list(self.reason_codes),
        }


def apply_ingest_surge_controls(
    *,
    source_type: str,
    base_priority: int,
    kill_switch: bool,
    noncritical_threshold: int = 3,
    global_throttle_multiplier: float = 1.0,
    source_throttle_map: dict[str, float] | None = None,
) -> IngestSurgeDecision:
    """
    Apply surge policy to one ingestion event.

    Behavior:
    - Global kill switch drops non-critical events.
    - Source-specific throttle map degrades priority for noisy sources.
    - Global throttle multiplier annotates downstream processing pressure.
    """
    priority = max(0, int(base_priority))
    reasons: list[str] = []

    if kill_switch and priority > max(0, int(noncritical_threshold)):
        reasons.append("kill_switch_drop_noncritical")
        return IngestSurgeDecision(
            priority=priority,
            drop_event=True,
            throttle_multiplier=max(0.1, _safe_float(global_throttle_multiplier, 1.0)),
            reason_codes=tuple(reasons),
        )

    normalized_source = str(source_type or "").strip().lower()
    per_source = (source_throttle_map or {}).get(normalized_source)
    if per_source is not None:
        factor = max(0.5, min(_safe_float(per_source, 1.0), 4.0))
        penalty = max(0, int(round((factor - 1.0) * 3.0)))
        if penalty > 0:
            priority = min(10, priority + penalty)
            reasons.append("source_priority_degraded")

    throttle_multiplier = max(0.1, min(_safe_float(global_throttle_multiplier, 1.0), 5.0))
    if throttle_multiplier > 1.0:
        reasons.append("global_throttle")

    if not reasons:
        reasons.append("steady_state")

    return IngestSurgeDecision(
        priority=priority,
        drop_event=False,
        throttle_multiplier=throttle_multiplier,
        reason_codes=tuple(reasons),
    )


def parse_source_throttle_map(raw: Any) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    parsed: dict[str, float] = {}
    for key, value in raw.items():
        source = str(key).strip().lower()
        if not source:
            continue
        parsed[source] = max(0.5, min(_safe_float(value, 1.0), 4.0))
    return parsed

