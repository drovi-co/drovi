"""Value-of-information scheduler for cognition workloads."""

from __future__ import annotations

from dataclasses import dataclass


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class AttentionItem:
    ref: str
    domain: str
    impact: float
    uncertainty: float
    freshness_lag_minutes: float
    processing_cost: float
    source_class: str = "authoritative"
    risk_tier: str = "medium"
    sla_minutes: float | None = None
    last_processed_lag_minutes: float | None = None


@dataclass(slots=True)
class AttentionDecision:
    ref: str
    voi_score: float
    priority: int
    run_after_seconds: int
    compute_units: float
    rationale: str

    def to_dict(self) -> dict[str, float | int | str]:
        return {
            "ref": self.ref,
            "voi_score": round(self.voi_score, 4),
            "priority": self.priority,
            "run_after_seconds": self.run_after_seconds,
            "compute_units": round(self.compute_units, 4),
            "rationale": self.rationale,
        }


class AttentionEngine:
    """Selects what to process first based on expected information value."""

    _SOURCE_WEIGHT = {
        "authoritative": 1.2,
        "commercial": 1.1,
        "osint": 0.9,
    }
    _RISK_WEIGHT = {
        "low": 0.9,
        "medium": 1.0,
        "high": 1.2,
        "critical": 1.45,
    }

    @classmethod
    def _sla_pressure(cls, item: AttentionItem) -> float:
        if item.sla_minutes is None or item.sla_minutes <= 0:
            return 0.0
        return _clamp(item.freshness_lag_minutes / item.sla_minutes, 0.0, 3.0)

    def score(self, item: AttentionItem) -> float:
        source_weight = self._SOURCE_WEIGHT.get(item.source_class, 1.0)
        risk_weight = self._RISK_WEIGHT.get(str(item.risk_tier).lower(), 1.0)
        impact = _clamp(item.impact, 0.0, 1.0)
        uncertainty = _clamp(item.uncertainty, 0.0, 1.0)
        lag_boost = 1.0 + min(max(item.freshness_lag_minutes, 0.0) / 240.0, 2.0)
        sla_boost = 1.0 + (0.35 * self._sla_pressure(item))
        cost = max(item.processing_cost, 0.1)
        return (impact * (0.4 + (0.6 * uncertainty)) * lag_boost * sla_boost * source_weight * risk_weight) / cost

    def schedule(
        self,
        *,
        items: list[AttentionItem],
        processing_budget: float,
        min_risk_floor: float = 0.1,
        starvation_threshold_minutes: float = 24.0 * 7.0,
        starvation_slots: int = 1,
    ) -> list[AttentionDecision]:
        budget = max(processing_budget, 0.0)
        if budget <= 0 or not items:
            return []

        remaining_budget = budget
        ranked = sorted(items, key=self.score, reverse=True)
        decisions: list[AttentionDecision] = []
        selected_refs: set[str] = set()

        starvation_candidates = sorted(
            [
                item
                for item in ranked
                if str(item.risk_tier).lower() in {"high", "critical"}
                and max(
                    _clamp(item.freshness_lag_minutes, 0.0, float("inf")),
                    _clamp(item.last_processed_lag_minutes or 0.0, 0.0, float("inf")),
                )
                >= max(0.0, starvation_threshold_minutes)
            ],
            key=lambda entry: (
                -max(entry.freshness_lag_minutes, entry.last_processed_lag_minutes or 0.0),
                -self.score(entry),
            ),
        )

        risk_floor_budget = budget * _clamp(min_risk_floor, 0.0, 0.5)
        reserved_budget_used = 0.0
        for item in starvation_candidates[: max(0, int(starvation_slots))]:
            if item.ref in selected_refs:
                continue
            can_spend_reserved = item.processing_cost <= max(0.0, risk_floor_budget - reserved_budget_used)
            can_spend_remaining = item.processing_cost <= remaining_budget or not decisions
            if not can_spend_reserved and not can_spend_remaining:
                continue
            selected_refs.add(item.ref)
            remaining_budget -= min(item.processing_cost, remaining_budget)
            reserved_budget_used += min(item.processing_cost, max(0.0, risk_floor_budget - reserved_budget_used))
            decisions.append(
                AttentionDecision(
                    ref=item.ref,
                    voi_score=self.score(item),
                    priority=len(decisions) + 1,
                    run_after_seconds=0,
                    compute_units=0.0,
                    rationale=(
                        f"anti_starvation,risk={item.risk_tier},lag={max(item.freshness_lag_minutes, item.last_processed_lag_minutes or 0.0):.1f}m,"
                        f"impact={item.impact:.2f}"
                    ),
                )
            )

        for item in ranked:
            if item.ref in selected_refs:
                continue
            if remaining_budget <= 0:
                break
            if item.processing_cost > remaining_budget and decisions:
                continue

            voi = self.score(item)
            remaining_budget -= item.processing_cost
            priority = len(decisions) + 1
            sla_pressure = self._sla_pressure(item)
            delay_multiplier = _clamp(1.0 - (0.25 * min(sla_pressure, 2.0)), 0.4, 1.0)
            run_after = max(0, int((priority - 1) * 20 * delay_multiplier))
            decisions.append(
                AttentionDecision(
                    ref=item.ref,
                    voi_score=voi,
                    priority=priority,
                    run_after_seconds=run_after,
                    compute_units=0.0,
                    rationale=(
                        f"domain={item.domain}, impact={item.impact:.2f}, "
                        f"uncertainty={item.uncertainty:.2f}, lag={item.freshness_lag_minutes:.1f}m, "
                        f"risk={item.risk_tier}, sla_pressure={sla_pressure:.2f}"
                    ),
                )
            )
            selected_refs.add(item.ref)

        if not decisions:
            return []

        item_by_ref = {item.ref: item for item in items}
        weights: list[float] = []
        for decision in decisions:
            item = item_by_ref.get(decision.ref)
            if item is None:
                weights.append(1.0)
                continue
            weight = max(decision.voi_score, 0.01) * (1.0 + (0.5 * self._sla_pressure(item)))
            weights.append(weight)

        weight_total = max(sum(weights), 0.0001)
        for index, decision in enumerate(decisions):
            allocation = budget * (weights[index] / weight_total)
            decision.compute_units = round(allocation, 6)

        return decisions
