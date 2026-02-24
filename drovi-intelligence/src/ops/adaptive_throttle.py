"""Adaptive compute throttles tied to VOI, SLA pressure, and backlog state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True, slots=True)
class AdaptiveThrottleDecision:
    priority_delta: int
    max_parallel_streams: int
    batch_size: int
    defer_seconds: int
    reason_codes: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "priority_delta": int(self.priority_delta),
            "max_parallel_streams": int(self.max_parallel_streams),
            "batch_size": int(self.batch_size),
            "defer_seconds": int(self.defer_seconds),
            "reason_codes": list(self.reason_codes),
        }


def derive_adaptive_throttle(
    *,
    voi_priority: float | None,
    freshness_lag_minutes: int | None,
    freshness_slo_minutes: int | None,
    queue_depth_ratio: float | None = None,
    degradation_throttle_multiplier: float = 1.0,
) -> AdaptiveThrottleDecision:
    """
    Derive compute throttle controls for connector sync execution.

    Inputs:
    - VOI priority: higher VOI receives more compute.
    - SLA pressure: higher lag/slo receives more compute.
    - Queue depth: high backlog receives stronger throttling for low-priority work.
    """
    voi = _clamp(_safe_float(voi_priority, 0.5), 0.0, 1.0)
    lag = max(0, int(freshness_lag_minutes or 0))
    slo = max(1, int(freshness_slo_minutes or 60))
    queue_ratio = _clamp(_safe_float(queue_depth_ratio, 0.0), 0.0, 1.0)
    degrade_multiplier = _clamp(_safe_float(degradation_throttle_multiplier, 1.0), 1.0, 4.0)

    sla_pressure = lag / float(slo)
    reason_codes: list[str] = []

    max_parallel_streams = 2
    batch_size = 96
    defer_seconds = 0
    priority_delta = 0

    if queue_ratio >= 0.85 and voi <= 0.45 and sla_pressure < 1.0:
        max_parallel_streams = 1
        batch_size = 48
        defer_seconds = 180
        priority_delta = 2
        reason_codes.append("queue_backpressure_low_voi")
    elif queue_ratio >= 0.65 and voi <= 0.6 and sla_pressure < 1.25:
        max_parallel_streams = 1
        batch_size = 64
        defer_seconds = 60
        priority_delta = 1
        reason_codes.append("moderate_backpressure")

    if voi >= 0.85 or sla_pressure >= 1.5:
        max_parallel_streams = max(max_parallel_streams, 3)
        batch_size = max(batch_size, 160)
        defer_seconds = 0
        priority_delta = max(0, priority_delta - 1)
        reason_codes.append("high_voi_or_sla_pressure")

    if degrade_multiplier > 1.0:
        scaled_batch = int(round(batch_size / degrade_multiplier))
        batch_size = max(32, scaled_batch)
        defer_seconds = int(round(defer_seconds * degrade_multiplier))
        reason_codes.append("degradation_multiplier_applied")

    if not reason_codes:
        reason_codes.append("steady_state")

    return AdaptiveThrottleDecision(
        priority_delta=priority_delta,
        max_parallel_streams=max_parallel_streams,
        batch_size=batch_size,
        defer_seconds=defer_seconds,
        reason_codes=tuple(reason_codes),
    )


def apply_adaptive_throttle_sync_params(
    *,
    sync_params: dict[str, object] | None,
    decision: AdaptiveThrottleDecision,
) -> dict[str, object]:
    payload = dict(sync_params or {})
    payload["adaptive_priority_delta"] = int(decision.priority_delta)
    payload["adaptive_max_parallel_streams"] = int(decision.max_parallel_streams)
    payload["adaptive_batch_size"] = int(decision.batch_size)
    payload["adaptive_defer_seconds"] = int(decision.defer_seconds)
    payload["adaptive_reason_codes"] = list(decision.reason_codes)
    return payload

