from __future__ import annotations

from typing import Any

from .models import TriggerRecord, TriggerRouteCandidate, TriggerRouteDecision, TriggerType
from .registry import AgentRegistryService


_TRIGGER_PRIORITY_BASE: dict[TriggerType, int] = {
    "manual": 300,
    "event": 200,
    "schedule": 100,
}


class TriggerRoutingService:
    """Route trigger invocations to the best matching deployment."""

    def __init__(self, registry: AgentRegistryService | None = None) -> None:
        self._registry = registry or AgentRegistryService()

    async def simulate(
        self,
        *,
        organization_id: str,
        trigger_type: TriggerType,
        deployment_id: str | None = None,
        event_name: str | None = None,
        source: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> TriggerRouteDecision:
        del metadata  # Reserved for future weighting and payload-specific matching.

        triggers = await self._registry.list_enabled_triggers(
            organization_id=organization_id,
            deployment_id=deployment_id,
        )
        candidates: list[TriggerRouteCandidate] = []

        for trigger in triggers:
            candidate = self._evaluate_candidate(
                trigger=trigger,
                trigger_type=trigger_type,
                event_name=event_name,
                source=source,
            )
            if candidate is not None:
                candidates.append(candidate)

        candidates.sort(key=lambda item: (-item.score, item.trigger_id))
        selected = candidates[0] if candidates else None
        return TriggerRouteDecision(
            organization_id=organization_id,
            trigger_type=trigger_type,
            selected=selected,
            candidates=candidates,
        )

    def _evaluate_candidate(
        self,
        *,
        trigger: TriggerRecord,
        trigger_type: TriggerType,
        event_name: str | None,
        source: str | None,
    ) -> TriggerRouteCandidate | None:
        if trigger.trigger_type != trigger_type:
            return None

        reasons: list[str] = [f"trigger_type:{trigger.trigger_type}"]
        score = _TRIGGER_PRIORITY_BASE[trigger_type]
        spec = dict(trigger.trigger_spec or {})
        score += int(spec.get("priority", 0))

        if trigger.deployment_status == "active":
            score += 20
            reasons.append("deployment_status:active")
        elif trigger.deployment_status == "canary":
            score += 10
            reasons.append("deployment_status:canary")

        if trigger_type == "event":
            expected_event = spec.get("event_name")
            expected_events = set(spec.get("events", []))
            if expected_event and event_name != expected_event:
                return None
            if expected_events and event_name not in expected_events:
                return None
            if expected_event:
                score += 5
                reasons.append("event_name:exact")
            if expected_events:
                score += 2
                reasons.append("event_name:list")

            expected_source = spec.get("source")
            if expected_source and source != expected_source:
                return None
            if expected_source:
                score += 3
                reasons.append("source:exact")

        if trigger_type == "schedule":
            if spec.get("cron"):
                score += 3
                reasons.append("schedule:cron")
            if spec.get("interval_minutes"):
                score += 2
                reasons.append("schedule:interval")

        if trigger_type == "manual":
            score += 1
            reasons.append("manual:direct")

        return TriggerRouteCandidate(
            trigger_id=trigger.id,
            deployment_id=trigger.deployment_id,
            score=score,
            reasons=reasons,
            trigger_spec=spec,
        )

