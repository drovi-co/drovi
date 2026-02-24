"""Capacity forecasting primitives for event rate, storage, and graph growth."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str) and value.strip():
        text = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class CapacityBudget:
    max_event_rate_eps: float
    max_storage_bytes: float
    max_graph_nodes: float

    def to_dict(self) -> dict[str, float]:
        return {
            "max_event_rate_eps": float(self.max_event_rate_eps),
            "max_storage_bytes": float(self.max_storage_bytes),
            "max_graph_nodes": float(self.max_graph_nodes),
        }


class CapacityForecastEngine:
    """
    Forecasts near-term infrastructure demand with robust defaults.

    This is intentionally conservative:
    - Uses recency-weighted growth rates.
    - Applies growth caps to avoid unstable extrapolation.
    - Returns both projections and budget breach estimates.
    """

    def _growth_rate(self, values: list[float]) -> float:
        if len(values) < 2:
            return 0.0
        deltas: list[float] = []
        for idx in range(1, len(values)):
            prev = max(values[idx - 1], 0.0001)
            curr = max(values[idx], 0.0)
            deltas.append((curr - prev) / prev)
        if not deltas:
            return 0.0
        weighted = 0.0
        total_weight = 0.0
        for idx, delta in enumerate(deltas, start=1):
            weight = float(idx)
            weighted += delta * weight
            total_weight += weight
        return _clamp(weighted / max(total_weight, 1.0), -0.4, 1.0)

    def _project(self, *, current: float, growth_rate: float, steps: int) -> list[float]:
        value = max(current, 0.0)
        output: list[float] = []
        for _ in range(steps):
            value = max(0.0, value * (1.0 + growth_rate))
            output.append(value)
        return output

    def _estimate_breach_day(self, *, current: float, growth_rate: float, budget: float) -> int | None:
        if budget <= 0 or current >= budget:
            return 0 if budget > 0 else None
        if growth_rate <= 0:
            return None
        value = current
        for day in range(1, 366 * 2):
            value *= 1.0 + growth_rate
            if value >= budget:
                return day
        return None

    def build_dashboard(
        self,
        *,
        history: list[dict[str, Any]],
        horizon_days: int = 30,
        budget: CapacityBudget | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        if not history:
            raise ValueError("capacity history is required")

        points = sorted(history, key=lambda row: _parse_ts(row.get("timestamp")))
        latest = points[-1]

        event_series = [_safe_float(item.get("event_rate_eps"), 0.0) for item in points]
        storage_series = [_safe_float(item.get("storage_bytes"), 0.0) for item in points]
        graph_series = [_safe_float(item.get("graph_nodes"), 0.0) for item in points]

        event_growth = self._growth_rate(event_series)
        storage_growth = self._growth_rate(storage_series)
        graph_growth = self._growth_rate(graph_series)

        steps = max(1, min(int(horizon_days), 365))
        event_projection = self._project(current=event_series[-1], growth_rate=event_growth, steps=steps)
        storage_projection = self._project(current=storage_series[-1], growth_rate=storage_growth, steps=steps)
        graph_projection = self._project(current=graph_series[-1], growth_rate=graph_growth, steps=steps)

        anchor = _parse_ts(latest.get("timestamp"))
        generated_at = (now or datetime.now(UTC)).isoformat()
        projection = [
            {
                "timestamp": (anchor + timedelta(days=idx + 1)).isoformat(),
                "event_rate_eps": round(event_projection[idx], 6),
                "storage_bytes": round(storage_projection[idx], 3),
                "graph_nodes": round(graph_projection[idx], 3),
            }
            for idx in range(steps)
        ]

        budget_obj = budget or CapacityBudget(
            max_event_rate_eps=10_000.0,
            max_storage_bytes=5_000_000_000_000.0,
            max_graph_nodes=5_000_000_000.0,
        )

        breaches = {
            "event_rate_eps": self._estimate_breach_day(
                current=event_series[-1],
                growth_rate=event_growth,
                budget=budget_obj.max_event_rate_eps,
            ),
            "storage_bytes": self._estimate_breach_day(
                current=storage_series[-1],
                growth_rate=storage_growth,
                budget=budget_obj.max_storage_bytes,
            ),
            "graph_nodes": self._estimate_breach_day(
                current=graph_series[-1],
                growth_rate=graph_growth,
                budget=budget_obj.max_graph_nodes,
            ),
        }

        return {
            "generated_at": generated_at,
            "history_points": len(points),
            "horizon_days": steps,
            "current": {
                "timestamp": anchor.isoformat(),
                "event_rate_eps": round(event_series[-1], 6),
                "storage_bytes": round(storage_series[-1], 3),
                "graph_nodes": round(graph_series[-1], 3),
            },
            "growth_rates": {
                "event_rate_eps": round(event_growth, 6),
                "storage_bytes": round(storage_growth, 6),
                "graph_nodes": round(graph_growth, 6),
            },
            "projection": projection,
            "budget": budget_obj.to_dict(),
            "estimated_breach_days": breaches,
        }

