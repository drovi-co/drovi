"""Provider outage and ingest degradation policy controls."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DegradationMode(str, Enum):
    NORMAL = "normal"
    PROVIDER_OUTAGE = "provider_outage"
    QUOTA_PRESSURE = "quota_pressure"
    LAG_BACKPRESSURE = "lag_backpressure"
    PARTIAL_SIGNAL = "partial_signal"


@dataclass(frozen=True, slots=True)
class DegradationDecision:
    mode: DegradationMode
    reason: str
    throttle_multiplier: float
    priority_penalty: int
    skip_noncritical: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "mode": self.mode.value,
            "reason": self.reason,
            "throttle_multiplier": round(float(self.throttle_multiplier), 4),
            "priority_penalty": int(self.priority_penalty),
            "skip_noncritical": bool(self.skip_noncritical),
        }


def derive_degradation_mode(
    *,
    provider_circuit_open: bool,
    quota_headroom_ratio: float | None,
    freshness_lag_minutes: int | None,
    freshness_slo_minutes: int | None,
    queue_depth_ratio: float | None = None,
) -> DegradationDecision:
    """
    Compute graceful degradation behavior for world-source ingestion.

    Precedence:
    1. Provider outage (hard degrade + non-critical suppression)
    2. Quota pressure (slow down to preserve API budgets)
    3. Lag backpressure (slow down low-priority sources during queue pressure)
    4. Normal
    """
    quota = max(0.0, min(float(quota_headroom_ratio or 1.0), 1.0))
    queue_ratio = max(0.0, min(float(queue_depth_ratio or 0.0), 1.0))
    lag_minutes = int(max(0, int(freshness_lag_minutes or 0)))
    lag_slo = max(1, int(freshness_slo_minutes or 60))

    if provider_circuit_open:
        return DegradationDecision(
            mode=DegradationMode.PROVIDER_OUTAGE,
            reason="Provider circuit breaker open; preserve state and defer non-critical syncs",
            throttle_multiplier=2.5,
            priority_penalty=3,
            skip_noncritical=True,
        )

    if quota <= 0.12:
        return DegradationDecision(
            mode=DegradationMode.QUOTA_PRESSURE,
            reason="Low provider quota headroom; reduce ingest pressure",
            throttle_multiplier=1.8,
            priority_penalty=2,
            skip_noncritical=True,
        )

    if queue_ratio >= 0.85 or lag_minutes > int(lag_slo * 2.5):
        return DegradationDecision(
            mode=DegradationMode.LAG_BACKPRESSURE,
            reason="Worker queue lag/backpressure detected; prioritizing high-value syncs",
            throttle_multiplier=1.4,
            priority_penalty=1,
            skip_noncritical=False,
        )

    return DegradationDecision(
        mode=DegradationMode.NORMAL,
        reason="No degradation signals detected",
        throttle_multiplier=1.0,
        priority_penalty=0,
        skip_noncritical=False,
    )


def apply_degradation_sync_params(
    *,
    sync_params: dict[str, object] | None,
    decision: DegradationDecision,
) -> dict[str, object]:
    payload = dict(sync_params or {})
    payload["degradation_mode"] = decision.mode.value
    payload["degradation_reason"] = decision.reason
    payload["degradation_throttle_multiplier"] = round(float(decision.throttle_multiplier), 4)
    payload["degradation_priority_penalty"] = int(decision.priority_penalty)
    payload["degradation_skip_noncritical"] = bool(decision.skip_noncritical)
    return payload

