"""Inference pool routing, queueing classes, and autoscaling controls."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from src.mlops.models import ModelFamily, RiskClass

PoolType = Literal["gpu", "cpu"]
PriorityClass = Literal["p0", "p1", "p2", "p3"]


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
class InferencePoolProfile:
    pool_id: str
    pool_type: PoolType
    supported_families: tuple[ModelFamily, ...]
    min_replicas: int
    max_replicas: int
    target_latency_ms: float
    target_utilization: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_id": self.pool_id,
            "pool_type": self.pool_type,
            "supported_families": list(self.supported_families),
            "min_replicas": self.min_replicas,
            "max_replicas": self.max_replicas,
            "target_latency_ms": round(float(self.target_latency_ms), 3),
            "target_utilization": round(float(self.target_utilization), 4),
        }


@dataclass(frozen=True, slots=True)
class DispatchDecision:
    pool_id: str
    queue_lane: str
    priority_class: PriorityClass
    estimated_wait_ms: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_id": self.pool_id,
            "queue_lane": self.queue_lane,
            "priority_class": self.priority_class,
            "estimated_wait_ms": self.estimated_wait_ms,
        }


@dataclass(frozen=True, slots=True)
class AutoscaleDecision:
    pool_id: str
    current_replicas: int
    desired_replicas: int
    action: Literal["scale_up", "scale_down", "hold"]
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_id": self.pool_id,
            "current_replicas": self.current_replicas,
            "desired_replicas": self.desired_replicas,
            "action": self.action,
            "reason": self.reason,
        }


class InferenceScalePlanner:
    """Computes pool routing, queue class, and autoscaling decisions."""

    def __init__(self, pools: list[InferencePoolProfile] | None = None) -> None:
        self._pools = pools or self._default_pools()
        self._pool_by_id = {pool.pool_id: pool for pool in self._pools}

    @staticmethod
    def _default_pools() -> list[InferencePoolProfile]:
        return [
            InferencePoolProfile(
                pool_id="inference-gpu-heavy",
                pool_type="gpu",
                supported_families=("verifier_nli", "graph_impact"),
                min_replicas=2,
                max_replicas=32,
                target_latency_ms=1200.0,
                target_utilization=0.75,
            ),
            InferencePoolProfile(
                pool_id="inference-cpu-throughput",
                pool_type="cpu",
                supported_families=("temporal_forecast", "generic"),
                min_replicas=4,
                max_replicas=64,
                target_latency_ms=700.0,
                target_utilization=0.7,
            ),
        ]

    def pool_inventory(self) -> list[dict[str, Any]]:
        return [item.to_dict() for item in self._pools]

    def _priority_class(self, *, risk_class: RiskClass, sla_minutes: int | None) -> PriorityClass:
        sla = max(0, _safe_int(sla_minutes, 60))
        if risk_class == "critical" or sla <= 5:
            return "p0"
        if risk_class == "high" or sla <= 15:
            return "p1"
        if risk_class == "medium" or sla <= 60:
            return "p2"
        return "p3"

    def _pick_pool(self, *, model_family: ModelFamily) -> InferencePoolProfile:
        for pool in self._pools:
            if model_family in pool.supported_families:
                return pool
        return self._pools[-1]

    def route_request(
        self,
        *,
        model_family: ModelFamily,
        risk_class: RiskClass,
        sla_minutes: int | None,
        backlog_depth: int = 0,
    ) -> DispatchDecision:
        pool = self._pick_pool(model_family=model_family)
        priority = self._priority_class(risk_class=risk_class, sla_minutes=sla_minutes)
        queue_lane = f"{pool.pool_id}:{priority}"
        estimated_wait_ms = max(0, int(backlog_depth)) * (40 if pool.pool_type == "cpu" else 90)
        if priority == "p0":
            estimated_wait_ms = int(estimated_wait_ms * 0.4)
        elif priority == "p1":
            estimated_wait_ms = int(estimated_wait_ms * 0.65)
        return DispatchDecision(
            pool_id=pool.pool_id,
            queue_lane=queue_lane,
            priority_class=priority,
            estimated_wait_ms=estimated_wait_ms,
        )

    def autoscale_pool(
        self,
        *,
        pool_id: str,
        backlog_depth: int,
        p95_latency_ms: float,
        utilization: float,
        current_replicas: int,
    ) -> AutoscaleDecision:
        pool = self._pool_by_id.get(pool_id)
        if pool is None:
            raise ValueError(f"Unknown inference pool: {pool_id}")

        backlog = max(0, _safe_int(backlog_depth))
        latency = max(0.0, _safe_float(p95_latency_ms))
        util = max(0.0, min(1.0, _safe_float(utilization)))
        current = max(pool.min_replicas, _safe_int(current_replicas, pool.min_replicas))

        scale_pressure = 0
        if backlog > 200:
            scale_pressure += min(6, int(backlog // 200))
        if latency > (pool.target_latency_ms * 1.2):
            scale_pressure += 2
        if util > (pool.target_utilization + 0.12):
            scale_pressure += 1

        if scale_pressure > 0:
            desired = min(pool.max_replicas, current + scale_pressure)
            action = "scale_up" if desired > current else "hold"
            reason = "backlog/latency/utilization above target"
            return AutoscaleDecision(
                pool_id=pool.pool_id,
                current_replicas=current,
                desired_replicas=desired,
                action=action,
                reason=reason,
            )

        down_pressure = backlog < 40 and latency < (pool.target_latency_ms * 0.65) and util < (pool.target_utilization * 0.55)
        if down_pressure:
            desired = max(pool.min_replicas, current - 1)
            action = "scale_down" if desired < current else "hold"
            reason = "sustained low backlog and latency"
            return AutoscaleDecision(
                pool_id=pool.pool_id,
                current_replicas=current,
                desired_replicas=desired,
                action=action,
                reason=reason,
            )

        return AutoscaleDecision(
            pool_id=pool.pool_id,
            current_replicas=current,
            desired_replicas=current,
            action="hold",
            reason="within target envelope",
        )

