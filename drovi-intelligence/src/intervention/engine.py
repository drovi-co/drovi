"""Governed intervention planning."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class PolicyClass(str, Enum):
    P0_FREEZE = "p0_freeze"
    P1_HUMAN_APPROVAL = "p1_human_approval"
    P2_GUARDRAILED = "p2_guardrailed"
    P3_AUTONOMOUS = "p3_autonomous"


@dataclass(slots=True)
class ActionStep:
    step_id: str
    action: str
    reversible: bool
    risk_score: float
    stage: str = "mitigation"


@dataclass(slots=True)
class ActionEdge:
    from_step_id: str
    to_step_id: str
    condition: str = "on_success"


@dataclass(slots=True)
class PolicyGate:
    gate_id: str
    gate_type: str
    status: str
    reason: str
    requires_approval: bool


@dataclass(slots=True)
class RollbackVerification:
    is_verified: bool
    missing_step_ids: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class InterventionCandidate:
    intervention_id: str
    target_ref: str
    policy_class: PolicyClass
    approval_class: str
    requires_human_approval: bool
    expected_utility_delta: float
    downside_risk_estimate: float
    action_steps: list[ActionStep] = field(default_factory=list)
    action_edges: list[ActionEdge] = field(default_factory=list)
    policy_gates: list[PolicyGate] = field(default_factory=list)
    rollback_steps: list[str] = field(default_factory=list)
    rollback_verification: RollbackVerification | None = None
    rationale: list[str] = field(default_factory=list)
    feedback_hooks: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        nodes = [
            {
                "step_id": step.step_id,
                "action": step.action,
                "stage": step.stage,
                "reversible": step.reversible,
                "risk_score": round(step.risk_score, 4),
            }
            for step in self.action_steps
        ]
        edges = [
            {
                "from_step_id": edge.from_step_id,
                "to_step_id": edge.to_step_id,
                "condition": edge.condition,
            }
            for edge in self.action_edges
        ]
        return {
            "intervention_id": self.intervention_id,
            "target_ref": self.target_ref,
            "policy_class": self.policy_class.value,
            "approval_class": self.approval_class,
            "requires_human_approval": self.requires_human_approval,
            "expected_utility_delta": round(self.expected_utility_delta, 4),
            "downside_risk_estimate": round(self.downside_risk_estimate, 4),
            "action_steps": nodes,
            "action_edges": edges,
            "action_graph": {
                "nodes": nodes,
                "edges": edges,
            },
            "policy_gates": [
                {
                    "gate_id": gate.gate_id,
                    "gate_type": gate.gate_type,
                    "status": gate.status,
                    "reason": gate.reason,
                    "requires_approval": gate.requires_approval,
                }
                for gate in self.policy_gates
            ],
            "rollback_steps": list(self.rollback_steps),
            "rollback_verification": (
                {
                    "is_verified": bool(self.rollback_verification.is_verified),
                    "missing_step_ids": list(self.rollback_verification.missing_step_ids),
                    "notes": list(self.rollback_verification.notes),
                }
                if self.rollback_verification is not None
                else None
            ),
            "rationale": list(self.rationale),
            "feedback_hooks": dict(self.feedback_hooks),
        }


class InterventionEngine:
    """Builds policy-scoped intervention plans with rollback paths."""

    def classify_policy(
        self,
        *,
        pressure_score: float,
        max_constraint_severity: str | None,
        causal_confidence: float,
    ) -> PolicyClass:
        pressure = _clamp(pressure_score, 0.0, 1.0)
        confidence = _clamp(causal_confidence, 0.0, 1.0)
        severity = (max_constraint_severity or "low").lower()

        if severity == "critical" or pressure >= 0.9:
            return PolicyClass.P0_FREEZE
        if severity == "high" or pressure >= 0.7 or confidence < 0.45:
            return PolicyClass.P1_HUMAN_APPROVAL
        if pressure >= 0.4 or confidence < 0.65:
            return PolicyClass.P2_GUARDRAILED
        return PolicyClass.P3_AUTONOMOUS

    def _build_action_graph(
        self,
        *,
        pressure_score: float,
        actions: list[str],
    ) -> tuple[list[ActionStep], list[ActionEdge]]:
        action_steps = [
            ActionStep(
                step_id=f"step_{index + 1}",
                action=action,
                reversible=True,
                risk_score=_clamp(pressure_score * (0.35 + (0.2 * index)), 0.05, 1.0),
                stage="mitigation" if index < max(1, len(actions) - 1) else "validation",
            )
            for index, action in enumerate(actions)
        ]

        action_edges: list[ActionEdge] = []
        for index in range(len(action_steps) - 1):
            action_edges.append(
                ActionEdge(
                    from_step_id=action_steps[index].step_id,
                    to_step_id=action_steps[index + 1].step_id,
                    condition="on_success",
                )
            )
        return action_steps, action_edges

    def _build_policy_gates(
        self,
        *,
        policy_class: PolicyClass,
        pressure_score: float,
        causal_confidence: float,
        max_constraint_severity: str | None,
    ) -> list[PolicyGate]:
        severity = (max_constraint_severity or "low").lower()
        gates: list[PolicyGate] = [
            PolicyGate(
                gate_id="gate_policy_class",
                gate_type="policy_class",
                status="blocked" if policy_class == PolicyClass.P0_FREEZE else "pass",
                reason=f"policy={policy_class.value}",
                requires_approval=policy_class in {PolicyClass.P0_FREEZE, PolicyClass.P1_HUMAN_APPROVAL},
            ),
            PolicyGate(
                gate_id="gate_causal_confidence",
                gate_type="confidence_threshold",
                status="pass" if causal_confidence >= 0.55 else "review",
                reason=f"causal_confidence={causal_confidence:.2f}",
                requires_approval=causal_confidence < 0.55,
            ),
            PolicyGate(
                gate_id="gate_pressure_budget",
                gate_type="risk_budget",
                status="pass" if pressure_score < 0.85 else "review",
                reason=f"pressure_score={pressure_score:.2f}",
                requires_approval=pressure_score >= 0.85,
            ),
            PolicyGate(
                gate_id="gate_constraint_severity",
                gate_type="constraint_severity",
                status="pass" if severity in {"none", "low", "medium"} else "review",
                reason=f"max_constraint_severity={severity}",
                requires_approval=severity in {"high", "critical"},
            ),
        ]
        return gates

    def _generate_rollback_steps(self, action_steps: list[ActionStep]) -> list[str]:
        rollback_steps = [
            f"rollback {step.step_id}: undo '{step.action}'"
            for step in action_steps
            if step.reversible
        ]
        if not rollback_steps:
            rollback_steps.append("manual rollback required")
        rollback_steps.append("rollback verification: confirm target metrics returned to baseline")
        return rollback_steps

    def _verify_rollback(
        self,
        *,
        action_steps: list[ActionStep],
        rollback_steps: list[str],
    ) -> RollbackVerification:
        missing: list[str] = []
        rollback_text = " ".join(rollback_steps).lower()
        for step in action_steps:
            if not step.reversible:
                continue
            if step.step_id.lower() not in rollback_text:
                missing.append(step.step_id)
        return RollbackVerification(
            is_verified=not missing,
            missing_step_ids=missing,
            notes=(
                ["Rollback plan covers all reversible actions"]
                if not missing
                else ["Rollback plan missing explicit entries for one or more reversible steps"]
            ),
        )

    def propose(
        self,
        *,
        target_ref: str,
        pressure_score: float,
        causal_confidence: float,
        max_constraint_severity: str | None,
        recommended_actions: list[str] | None = None,
    ) -> InterventionCandidate:
        policy_class = self.classify_policy(
            pressure_score=pressure_score,
            max_constraint_severity=max_constraint_severity,
            causal_confidence=causal_confidence,
        )

        actions = list(recommended_actions or [])
        if not actions:
            actions = [
                "open analyst review",
                "tighten monitoring threshold",
                "stage mitigation in sandbox",
                "run post-action verification",
            ]

        pressure = _clamp(pressure_score, 0.0, 1.0)
        confidence = _clamp(causal_confidence, 0.0, 1.0)
        action_steps, action_edges = self._build_action_graph(
            pressure_score=pressure,
            actions=actions,
        )
        policy_gates = self._build_policy_gates(
            policy_class=policy_class,
            pressure_score=pressure,
            causal_confidence=confidence,
            max_constraint_severity=max_constraint_severity,
        )

        rollback_steps = self._generate_rollback_steps(action_steps)
        rollback_verification = self._verify_rollback(
            action_steps=action_steps,
            rollback_steps=rollback_steps,
        )

        requires_human_approval = any(
            gate.requires_approval and gate.status in {"review", "blocked"}
            for gate in policy_gates
        ) or policy_class in {PolicyClass.P0_FREEZE, PolicyClass.P1_HUMAN_APPROVAL}

        expected_utility = _clamp(
            (pressure * confidence)
            - (0.03 * len(action_steps))
            - (0.1 if policy_class == PolicyClass.P0_FREEZE else 0.0),
            -1.0,
            1.0,
        )
        downside_risk = _clamp(
            ((1.0 - confidence) * pressure) + (0.025 * len(action_steps)),
            0.0,
            1.0,
        )

        rationale = [
            f"pressure_score={pressure:.2f}",
            f"causal_confidence={confidence:.2f}",
            f"max_constraint_severity={(max_constraint_severity or 'none').lower()}",
            f"policy_class={policy_class.value}",
        ]

        feedback_hooks = {
            "capture_windows_hours": [24, 72, 168],
            "success_metrics": [
                "pressure_score",
                "risk_score",
                "overdue_commitments",
                "constraint_violation_count",
            ],
            "minimum_observation_confidence": round(max(0.35, confidence - 0.1), 2),
        }

        return InterventionCandidate(
            intervention_id=f"intv_{uuid4().hex[:16]}",
            target_ref=target_ref,
            policy_class=policy_class,
            approval_class="human" if requires_human_approval else "autonomous",
            requires_human_approval=requires_human_approval,
            expected_utility_delta=expected_utility,
            downside_risk_estimate=downside_risk,
            action_steps=action_steps,
            action_edges=action_edges,
            policy_gates=policy_gates,
            rollback_steps=rollback_steps,
            rollback_verification=rollback_verification,
            rationale=rationale,
            feedback_hooks=feedback_hooks,
        )
