"""Lakehouse query/compute tier planner for historical workloads."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class ComputeTierPlan:
    mode: str
    queue: str
    max_scan_rows: int
    timeout_seconds: int
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "queue": self.queue,
            "max_scan_rows": self.max_scan_rows,
            "timeout_seconds": self.timeout_seconds,
            "reason": self.reason,
        }


class LakehouseComputeTier:
    """
    Selects compute lane for lakehouse reads.

    - interactive: low-latency operator or product UX reads.
    - historical_batch: long-running analytical replay/training reads.
    """

    def plan(
        self,
        *,
        lookback_hours: int,
        estimated_rows: int,
        priority: str = "normal",
    ) -> ComputeTierPlan:
        horizon = max(1, int(lookback_hours))
        rows = max(0, int(estimated_rows))
        priority_value = str(priority or "normal").strip().lower()

        if priority_value in {"critical", "high"} and rows <= 250_000 and horizon <= 24 * 7:
            return ComputeTierPlan(
                mode="interactive",
                queue="lakehouse-interactive",
                max_scan_rows=500_000,
                timeout_seconds=60,
                reason="high-priority low-scan workload",
            )

        if rows > 1_500_000 or horizon > 24 * 30:
            return ComputeTierPlan(
                mode="historical_batch",
                queue="lakehouse-historical",
                max_scan_rows=25_000_000,
                timeout_seconds=1800,
                reason="large historical scan workload",
            )

        return ComputeTierPlan(
            mode="interactive",
            queue="lakehouse-standard",
            max_scan_rows=2_000_000,
            timeout_seconds=300,
            reason="balanced analytical query",
        )

    def summarize_request(
        self,
        *,
        table_name: str,
        lookback_hours: int,
        estimated_rows: int,
        priority: str = "normal",
        requested_at: datetime | None = None,
    ) -> dict[str, Any]:
        plan = self.plan(
            lookback_hours=lookback_hours,
            estimated_rows=estimated_rows,
            priority=priority,
        )
        return {
            "table_name": table_name,
            "lookback_hours": max(1, int(lookback_hours)),
            "estimated_rows": max(0, int(estimated_rows)),
            "priority": str(priority or "normal"),
            "requested_at": (requested_at or datetime.utcnow()).isoformat(),
            "plan": plan.to_dict(),
        }

