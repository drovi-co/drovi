"""World Brain queue/freshness autoscaling planner.

The planner intentionally adjusts HPA `minReplicas` rather than deployment
replicas directly, so CPU/memory-driven HPA behavior remains authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import math


DEFAULT_POOL_HPA_NAMES: dict[str, str] = {
    "normalize": "drovi-world-normalize-worker",
    "graph": "drovi-world-graph-worker",
    "ml": "drovi-world-ml-worker",
    "simulation": "drovi-world-simulation-worker",
    "critical": "drovi-world-critical-worker",
}

POOL_JOB_TYPES: dict[str, tuple[str, ...]] = {
    "normalize": ("connector.sync",),
    "graph": ("impact.compute", "normative.sentinel", "world_twin.stream_update"),
    "ml": (
        "learning.feedback.ingest",
        "learning.recalibrate",
        "mlops.shadow.evaluate",
        "mlops.canary.evaluate",
        "hypothesis.generate",
        "hypothesis.rescore",
    ),
    "simulation": ("simulation.run", "intervention.propose", "intervention.outcome.capture"),
    "critical": (
        "connector.sync",
        "connectors.health_monitor",
        "impact.compute",
        "normative.sentinel",
        "world_twin.snapshot",
        "world_twin.stream_update",
        "world_twin.prematerialize",
        "lakehouse.lifecycle",
        "source.reliability.calibrate",
    ),
}

FRESHNESS_POOL_WEIGHT: dict[str, float] = {
    "normalize": 1.2,
    "graph": 1.0,
    "ml": 0.4,
    "simulation": 0.3,
    "critical": 1.2,
}

ANNOTATION_LAST_SCALE_AT = "world-brain.autoscaler/last-scale-at"
ANNOTATION_LAST_ACTION = "world-brain.autoscaler/last-action"
ANNOTATION_LAST_REASON = "world-brain.autoscaler/last-reason"


@dataclass(frozen=True, slots=True)
class HPAPoolState:
    pool: str
    hpa_name: str
    min_replicas: int
    max_replicas: int
    annotations: dict[str, str]


@dataclass(frozen=True, slots=True)
class ScaleDecision:
    pool: str
    hpa_name: str
    current_min_replicas: int
    desired_min_replicas: int
    action: str
    reason: str
    queue_depth: int
    freshness_lag_minutes: float
    queue_pressure: int
    freshness_pressure: int
    cooldown_blocked: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "pool": self.pool,
            "hpa_name": self.hpa_name,
            "current_min_replicas": self.current_min_replicas,
            "desired_min_replicas": self.desired_min_replicas,
            "action": self.action,
            "reason": self.reason,
            "queue_depth": self.queue_depth,
            "freshness_lag_minutes": round(self.freshness_lag_minutes, 3),
            "queue_pressure": self.queue_pressure,
            "freshness_pressure": self.freshness_pressure,
            "cooldown_blocked": self.cooldown_blocked,
        }


def aggregate_pool_queue_depths(job_counts: dict[str, int]) -> dict[str, int]:
    normalized_counts = {
        str(job_type): max(0, int(count))
        for job_type, count in (job_counts or {}).items()
    }
    out: dict[str, int] = {}
    for pool, job_types in POOL_JOB_TYPES.items():
        out[pool] = int(sum(normalized_counts.get(job_type, 0) for job_type in job_types))
    return out


def _queue_pressure(queue_depth: int) -> int:
    depth = max(0, int(queue_depth))
    if depth >= 1000:
        return 6
    if depth >= 500:
        return 5
    if depth >= 250:
        return 4
    if depth >= 100:
        return 3
    if depth >= 25:
        return 2
    if depth >= 10:
        return 1
    return 0


def _freshness_pressure(freshness_lag_minutes: float) -> int:
    lag = max(0.0, float(freshness_lag_minutes))
    if lag >= 360.0:
        return 4
    if lag >= 180.0:
        return 3
    if lag >= 90.0:
        return 2
    if lag >= 45.0:
        return 1
    return 0


def _parse_last_scale_at(annotations: dict[str, str], *, now: datetime) -> datetime | None:
    raw = str(annotations.get(ANNOTATION_LAST_SCALE_AT) or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    if parsed > now + timedelta(minutes=5):
        return None
    return parsed


def build_scale_decision(
    *,
    state: HPAPoolState,
    queue_depth: int,
    freshness_lag_minutes: float,
    now: datetime,
    cooldown_seconds: int,
    max_step_change: int,
    scale_down_queue_threshold: int,
    scale_down_freshness_threshold_minutes: int,
) -> ScaleDecision:
    current_min = max(1, int(state.min_replicas))
    max_replicas = max(current_min, int(state.max_replicas))
    safe_step = max(1, int(max_step_change))

    q_pressure = _queue_pressure(queue_depth)
    base_f_pressure = _freshness_pressure(freshness_lag_minutes)
    weighted_f_pressure = int(
        max(
            0,
            math.floor(base_f_pressure * float(FRESHNESS_POOL_WEIGHT.get(state.pool, 1.0))),
        )
    )

    raw_target = 1 + q_pressure + weighted_f_pressure
    bounded_target = max(1, min(max_replicas, raw_target))

    last_scale_at = _parse_last_scale_at(state.annotations or {}, now=now)
    in_cooldown = False
    if last_scale_at is not None:
        cooldown = timedelta(seconds=max(0, int(cooldown_seconds)))
        in_cooldown = (now - last_scale_at) < cooldown

    action = "hold"
    desired = current_min
    reason = "within envelope"
    cooldown_blocked = False

    if bounded_target > current_min:
        desired = min(bounded_target, current_min + safe_step)
        action = "scale_up" if desired > current_min else "hold"
        reason = "queue/freshness pressure elevated"
    elif bounded_target < current_min:
        if queue_depth > int(scale_down_queue_threshold) or freshness_lag_minutes > float(
            scale_down_freshness_threshold_minutes
        ):
            reason = "scale-down blocked by active pressure"
            desired = current_min
        elif in_cooldown:
            reason = "scale-down blocked by cooldown window"
            desired = current_min
            cooldown_blocked = True
        else:
            desired = max(bounded_target, current_min - safe_step, 1)
            action = "scale_down" if desired < current_min else "hold"
            reason = "pressure reduced"

    return ScaleDecision(
        pool=state.pool,
        hpa_name=state.hpa_name,
        current_min_replicas=current_min,
        desired_min_replicas=desired,
        action=action,
        reason=reason,
        queue_depth=max(0, int(queue_depth)),
        freshness_lag_minutes=max(0.0, float(freshness_lag_minutes)),
        queue_pressure=q_pressure,
        freshness_pressure=weighted_f_pressure,
        cooldown_blocked=cooldown_blocked,
    )

