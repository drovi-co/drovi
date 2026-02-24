"""World Brain dry-run orchestration over multi-memory layers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from src.attention import AttentionEngine, AttentionItem
from src.causal import CausalEdge, CausalEngine
from src.epistemics import BeliefState, EpistemicEngine, EvidenceSignal
from src.hypothesis import HypothesisEngine
from src.intervention import InterventionEngine
from src.kernel.time import utc_now
from src.learning import LearningEngine
from src.normative import NormativeConstraint, NormativeEngine
from src.world_model import WorldEvent, WorldTwinMaterializer
from src.world_model.impact import ImpactEngineV2


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return utc_now()


def _coerce_belief_state(value: Any) -> BeliefState:
    try:
        return BeliefState(str(value).strip().lower())
    except ValueError:
        return BeliefState.ASSERTED


@dataclass(slots=True)
class WorldBrainDryRunInput:
    organization_id: str
    internal_objects: list[Mapping[str, Any]] = field(default_factory=list)
    external_events: list[WorldEvent | Mapping[str, Any]] = field(default_factory=list)
    strategic_context: Mapping[str, Any] = field(default_factory=dict)
    as_of: datetime | None = None


class WorldBrainDryRunPipeline:
    """Runs all new memory layers in deterministic dry-run mode."""

    def __init__(self) -> None:
        self.world_model = WorldTwinMaterializer()
        self.epistemics = EpistemicEngine()
        self.hypothesis = HypothesisEngine()
        self.causal = CausalEngine()
        self.impact = ImpactEngineV2()
        self.normative = NormativeEngine()
        self.attention = AttentionEngine()
        self.intervention = InterventionEngine()
        self.learning = LearningEngine()

    def execute(self, request: WorldBrainDryRunInput) -> dict[str, Any]:
        normalized_events = [
            event if isinstance(event, WorldEvent) else WorldEvent.from_dict(event)
            for event in request.external_events
        ]

        twin_snapshot = self.world_model.materialize(
            organization_id=request.organization_id,
            internal_objects=list(request.internal_objects),
            external_events=normalized_events,
            as_of=request.as_of,
        )

        belief_updates = self._run_epistemic_layer(
            internal_objects=list(request.internal_objects),
            external_events=normalized_events,
            strategic_context=request.strategic_context,
        )
        hypotheses = self._run_hypothesis_layer(
            belief_updates=belief_updates,
            external_events=normalized_events,
        )
        causal_projection = self._run_causal_layer(
            external_events=normalized_events,
            strategic_context=request.strategic_context,
            twin_snapshot=twin_snapshot,
        )
        impact_bridges = self._run_impact_layer(
            internal_objects=list(request.internal_objects),
            external_events=normalized_events,
            strategic_context=request.strategic_context,
            causal_projection=causal_projection,
        )
        violations = self._run_normative_layer(request.strategic_context, twin_snapshot)
        attention_queue = self._run_attention_layer(normalized_events, twin_snapshot, request.strategic_context)
        interventions = self._run_intervention_layer(
            twin_snapshot=twin_snapshot,
            violations=violations,
            causal_projection=causal_projection,
            strategic_context=request.strategic_context,
        )
        learning_snapshot = self._run_learning_layer(request.strategic_context)

        return {
            "organization_id": request.organization_id,
            "as_of": (request.as_of or utc_now()).isoformat(),
            "twin_snapshot": twin_snapshot.to_dict(),
            "belief_updates": belief_updates,
            "hypotheses": hypotheses,
            "causal_projection": causal_projection,
            "impact_bridges": impact_bridges,
            "constraint_violations": violations,
            "attention_queue": attention_queue,
            "interventions": interventions,
            "learning": learning_snapshot,
            "summary": {
                "belief_count": len(belief_updates),
                "hypothesis_count": len(hypotheses),
                "causal_impact_count": len(causal_projection),
                "impact_bridge_count": len(impact_bridges),
                "violation_count": len(violations),
                "attention_count": len(attention_queue),
                "intervention_count": len(interventions),
            },
        }

    def _run_epistemic_layer(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[WorldEvent],
        strategic_context: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        belief_inputs = list(strategic_context.get("beliefs") or [])
        if not belief_inputs:
            belief_inputs = self._derive_beliefs_from_internal(internal_objects)

        updates: list[dict[str, Any]] = []
        contradictory_domains = {
            str(item).lower()
            for item in list(strategic_context.get("contradictory_domains") or [])
        }

        for belief in belief_inputs:
            belief_id = str(belief.get("belief_id") or belief.get("id") or "belief_unknown")
            proposition = str(belief.get("proposition") or belief.get("title") or belief_id)
            current_state = _coerce_belief_state(belief.get("state") or "asserted")
            probability = _as_float(belief.get("probability"), 0.5)
            uncertainty = _as_float(belief.get("uncertainty"), 0.5)

            signals = self._coerce_signals(list(belief.get("signals") or []), external_events, contradictory_domains)
            transition = self.epistemics.transition(
                current_state=current_state,
                current_probability=probability,
                signals=signals,
                prior_uncertainty=uncertainty,
            )
            transition_payload = transition.to_dict()
            transition_payload["belief_id"] = belief_id
            transition_payload["proposition"] = proposition
            updates.append(transition_payload)

        return updates

    def _run_hypothesis_layer(
        self,
        *,
        belief_updates: list[dict[str, Any]],
        external_events: list[WorldEvent],
    ) -> list[dict[str, Any]]:
        observation_texts = [
            str(event.payload.get("title") or event.payload.get("summary") or event.source)
            for event in external_events
        ]

        generated: list[dict[str, Any]] = []
        for update in belief_updates[:10]:
            candidates = self.hypothesis.generate_alternatives(
                belief_id=str(update.get("belief_id") or "belief_unknown"),
                proposition=str(update.get("proposition") or ""),
                observations=observation_texts,
                base_probability=_as_float(update.get("next_probability"), 0.5),
                max_candidates=3,
            )
            accepted, rejected = self.hypothesis.reject_low_quality(candidates)
            generated.extend([candidate.to_dict() for candidate in accepted])
            generated.extend(
                [
                    {
                        **candidate.to_dict(),
                        "status": "rejected",
                        "rejection_reason": "score_below_threshold",
                    }
                    for candidate in rejected
                ]
            )

        return generated

    def _run_causal_layer(
        self,
        *,
        external_events: list[WorldEvent],
        strategic_context: Mapping[str, Any],
        twin_snapshot: Any,
    ) -> list[dict[str, Any]]:
        edge_payloads = list(strategic_context.get("causal_edges") or [])
        edges: list[CausalEdge] = []
        for payload in edge_payloads:
            edge = CausalEdge(
                edge_id=str(payload.get("edge_id") or payload.get("id") or "edge_unknown"),
                source_ref=str(payload.get("source_ref") or payload.get("from_ref") or "source_unknown"),
                target_ref=str(payload.get("target_ref") or payload.get("to_ref") or "target_unknown"),
                sign=-1 if int(payload.get("sign") or 1) < 0 else 1,
                strength=_as_float(payload.get("strength"), 0.5),
                lag_hours=_as_float(payload.get("lag_hours"), 24.0),
                lag_distribution=(
                    payload.get("lag_distribution")
                    if isinstance(payload.get("lag_distribution"), dict)
                    else None
                ),
                confidence=_as_float(payload.get("confidence"), 0.5),
                evidence_refs=[str(item) for item in list(payload.get("evidence_refs") or [])],
                updated_at=_as_datetime(payload.get("updated_at")),
            )
            if "observed_delta" in payload and "expected_delta" in payload:
                self.causal.update_edge(
                    edge,
                    observed_delta=_as_float(payload.get("observed_delta"), 0.0),
                    expected_delta=_as_float(payload.get("expected_delta"), 0.0),
                    observation_confidence=_as_float(payload.get("observation_confidence"), 0.5),
                    observed_lag_hours=(
                        _as_float(payload.get("observed_lag_hours"), 0.0)
                        if payload.get("observed_lag_hours") is not None
                        else None
                    ),
                )
            edges.append(edge)

        if not edges:
            return []

        if twin_snapshot.entity_states:
            hottest_entity = max(
                twin_snapshot.entity_states.values(),
                key=lambda state: state.pressure_score,
            )
            origin_ref = hottest_entity.entity_id
            magnitude = max(hottest_entity.pressure_score / 10.0, 0.05)
        elif external_events and external_events[0].entity_refs:
            origin_ref = external_events[0].entity_refs[0]
            magnitude = max(external_events[0].reliability, 0.05)
        else:
            origin_ref = edges[0].source_ref
            magnitude = 0.2

        impacts = self.causal.propagate_second_order_impacts(
            edges=edges,
            origin_ref=origin_ref,
            magnitude=magnitude,
            max_hops=3,
            horizon_hours=24.0 * 14.0,
        )
        return [impact.to_dict() for impact in impacts]

    def _run_normative_layer(
        self,
        strategic_context: Mapping[str, Any],
        twin_snapshot: Any,
    ) -> list[dict[str, Any]]:
        constraint_payloads = list(strategic_context.get("constraints") or [])
        constraints = [
            NormativeConstraint(
                constraint_id=str(item.get("constraint_id") or item.get("id") or "constraint_unknown"),
                title=str(item.get("title") or "constraint"),
                machine_rule=str(item.get("machine_rule") or "fact:world.max_pressure <= 1"),
                severity_on_breach=str(item.get("severity_on_breach") or "medium"),
                jurisdiction=item.get("jurisdiction"),
                is_active=bool(item.get("is_active", True)),
                source_class=str(item.get("source_class") or item.get("origin_type") or "policy"),
                obligation_type=str(item.get("obligation_type") or "must"),
                scope_entities=[str(ref) for ref in list(item.get("scope_entities") or item.get("entity_refs") or []) if ref],
                scope_actions=[str(action) for action in list(item.get("scope_actions") or item.get("action_refs") or []) if action],
                pre_breach_threshold=(
                    _as_float(item.get("pre_breach_threshold"), 0.9)
                    if item.get("pre_breach_threshold") is not None
                    else None
                ),
                evidence_refs=[str(ref) for ref in list(item.get("evidence_refs") or []) if ref],
            )
            for item in constraint_payloads
        ]

        facts = dict(strategic_context.get("facts") or {})
        world_facts = dict(facts.get("world") or {})
        world_facts.setdefault("max_pressure", max((state.pressure_score for state in twin_snapshot.entity_states.values()), default=0.0))
        world_facts.setdefault("domain_pressure", twin_snapshot.domain_pressure)
        facts["world"] = world_facts

        violations = self.normative.evaluate(constraints=constraints, facts=facts)
        return [violation.to_dict() for violation in violations]

    def _run_impact_layer(
        self,
        *,
        internal_objects: list[Mapping[str, Any]],
        external_events: list[WorldEvent],
        strategic_context: Mapping[str, Any],
        causal_projection: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        external_payloads = [
            {
                "event_id": event.event_id,
                "domain": event.domain,
                "reliability": event.reliability,
                "entity_refs": list(event.entity_refs),
                "evidence_link_ids": list(event.payload.get("evidence_link_ids") or []),
                **dict(event.payload),
            }
            for event in external_events
        ]

        causal_strength_by_ref = dict(strategic_context.get("causal_strength_by_ref") or {})
        if not causal_strength_by_ref:
            for item in causal_projection:
                target_ref = str(item.get("target_ref") or "").strip()
                confidence = _as_float(item.get("confidence"), 0.0)
                if target_ref:
                    causal_strength_by_ref[target_ref] = max(
                        confidence,
                        _as_float(causal_strength_by_ref.get(target_ref), 0.0),
                    )

        candidates = self.impact.compute_bridges(
            internal_objects=internal_objects,
            external_events=external_payloads,
            risk_overlay=dict(strategic_context.get("risk_overlay") or {}),
            causal_strength_by_ref=causal_strength_by_ref,
            min_score=_as_float(strategic_context.get("impact_min_score"), 0.35),
            max_per_internal=max(1, int(_as_float(strategic_context.get("impact_max_per_internal"), 3))),
            max_total=max(1, int(_as_float(strategic_context.get("impact_max_total"), 30))),
        )
        return [candidate.to_dict() for candidate in candidates]

    def _run_attention_layer(
        self,
        events: list[WorldEvent],
        twin_snapshot: Any,
        strategic_context: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        budget = _as_float(strategic_context.get("attention_budget"), 5.0)
        items: list[AttentionItem] = []
        for event in events:
            pressure = 0.0
            if event.entity_refs:
                pressure = max(
                    (
                        twin_snapshot.entity_states.get(ref).pressure_score
                        if twin_snapshot.entity_states.get(ref) is not None
                        else 0.0
                    )
                    for ref in event.entity_refs
                )
            lag_minutes = max((utc_now() - event.observed_at).total_seconds() / 60.0, 0.0)
            items.append(
                AttentionItem(
                    ref=event.event_id,
                    domain=event.domain,
                    impact=min(1.0, max(event.reliability, pressure / 10.0)),
                    uncertainty=1.0 - event.reliability,
                    freshness_lag_minutes=lag_minutes,
                    processing_cost=max(0.5, 0.5 + (len(event.payload) * 0.01)),
                    source_class=str(event.payload.get("source_class") or "authoritative"),
                )
            )

        decisions = self.attention.schedule(items=items, processing_budget=budget)
        return [decision.to_dict() for decision in decisions]

    def _run_intervention_layer(
        self,
        *,
        twin_snapshot: Any,
        violations: list[dict[str, Any]],
        causal_projection: list[dict[str, Any]],
        strategic_context: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        max_violation_severity = "low"
        severity_order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        for violation in violations:
            severity = str(violation.get("severity") or "low").lower()
            if severity_order.get(severity, 0) > severity_order.get(max_violation_severity, 0):
                max_violation_severity = severity

        confidence_values = [
            _as_float(item.get("confidence"), 0.5)
            for item in causal_projection
            if item.get("confidence") is not None
        ]
        causal_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0.5

        interventions: list[dict[str, Any]] = []
        top_entities = sorted(
            twin_snapshot.entity_states.values(),
            key=lambda state: state.pressure_score,
            reverse=True,
        )

        recommendations = list(strategic_context.get("recommended_actions") or [])
        for entity_state in top_entities[:3]:
            candidate = self.intervention.propose(
                target_ref=entity_state.entity_id,
                pressure_score=min(1.0, entity_state.pressure_score / 10.0),
                causal_confidence=causal_confidence,
                max_constraint_severity=max_violation_severity,
                recommended_actions=recommendations,
            )
            interventions.append(candidate.to_dict())

        return interventions

    def _run_learning_layer(self, strategic_context: Mapping[str, Any]) -> dict[str, Any]:
        outcomes = list(strategic_context.get("outcomes") or [])
        feedback = [
            self.learning.make_feedback(
                object_ref=str(item.get("object_ref") or item.get("id") or "unknown"),
                source_key=str(item.get("source_key") or "unknown"),
                predicted_probability=_as_float(item.get("predicted_probability"), 0.5),
                observed_outcome=int(item.get("observed_outcome") or 0),
                observed_at=_as_datetime(item.get("observed_at")) if item.get("observed_at") else None,
            )
            for item in outcomes
        ]
        snapshot = self.learning.build_snapshot(feedback)
        return snapshot.to_dict()

    def _derive_beliefs_from_internal(
        self,
        internal_objects: list[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        beliefs: list[dict[str, Any]] = []
        for item in internal_objects[:12]:
            belief_id = str(item.get("id") or item.get("uio_id") or "belief_unknown")
            proposition = str(
                item.get("title")
                or item.get("canonical_title")
                or item.get("description")
                or item.get("canonical_description")
                or belief_id
            )
            beliefs.append(
                {
                    "belief_id": belief_id,
                    "proposition": proposition,
                    "probability": _as_float(item.get("probability"), 0.55),
                    "state": str(item.get("belief_state") or "asserted"),
                    "uncertainty": _as_float(item.get("uncertainty"), 0.5),
                }
            )
        return beliefs

    def _coerce_signals(
        self,
        explicit_signals: list[Mapping[str, Any]],
        external_events: list[WorldEvent],
        contradictory_domains: set[str],
    ) -> list[EvidenceSignal]:
        signals: list[EvidenceSignal] = []

        for item in explicit_signals:
            signals.append(
                EvidenceSignal(
                    direction=str(item.get("direction") or "support"),
                    strength=_as_float(item.get("strength"), 0.5),
                    reliability=_as_float(item.get("reliability"), 0.5),
                    freshness_hours=_as_float(item.get("freshness_hours"), 24.0),
                    source_ref=str(item.get("source_ref")) if item.get("source_ref") else None,
                )
            )

        if signals:
            return signals

        now = utc_now()
        for event in external_events[:12]:
            age_hours = max((now - event.observed_at).total_seconds() / 3600.0, 0.0)
            direction = "contradict" if event.domain in contradictory_domains else "support"
            signals.append(
                EvidenceSignal(
                    direction=direction,
                    strength=max(0.1, event.reliability),
                    reliability=event.reliability,
                    freshness_hours=age_hours,
                    source_ref=event.event_id,
                )
            )

        return signals
