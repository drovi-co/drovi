"""Epistemic state transitions for belief updates."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import math


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class BeliefState(str, Enum):
    ASSERTED = "asserted"
    CORROBORATED = "corroborated"
    CONTESTED = "contested"
    DEGRADED = "degraded"
    RETRACTED = "retracted"
    UNKNOWN = "unknown"


@dataclass(slots=True)
class EvidenceSignal:
    direction: str  # support, contradict, neutral
    strength: float
    reliability: float = 0.5
    freshness_hours: float = 24.0
    source_ref: str | None = None

    def weighted_strength(self) -> float:
        freshness_decay = 1.0 / (1.0 + max(self.freshness_hours, 0.0) / 72.0)
        return _clamp(self.strength, 0.0, 1.0) * _clamp(self.reliability, 0.0, 1.0) * freshness_decay


@dataclass(slots=True)
class BeliefTransition:
    previous_state: BeliefState
    next_state: BeliefState
    previous_probability: float
    next_probability: float
    uncertainty: float
    support_score: float
    contradiction_score: float
    rationale: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, float | str | list[str]]:
        return {
            "previous_state": self.previous_state.value,
            "next_state": self.next_state.value,
            "previous_probability": round(self.previous_probability, 4),
            "next_probability": round(self.next_probability, 4),
            "uncertainty": round(self.uncertainty, 4),
            "support_score": round(self.support_score, 4),
            "contradiction_score": round(self.contradiction_score, 4),
            "rationale": list(self.rationale),
        }


class EpistemicEngine:
    """Applies evidence signals to transition beliefs with explicit uncertainty."""

    def transition(
        self,
        *,
        current_state: BeliefState,
        current_probability: float,
        signals: list[EvidenceSignal],
        prior_uncertainty: float = 0.5,
    ) -> BeliefTransition:
        previous_probability = _clamp(current_probability, 0.0, 1.0)
        uncertainty = _clamp(prior_uncertainty, 0.0, 1.0)

        if not signals:
            next_state = BeliefState.UNKNOWN if current_state == BeliefState.ASSERTED else current_state
            return BeliefTransition(
                previous_state=current_state,
                next_state=next_state,
                previous_probability=previous_probability,
                next_probability=previous_probability,
                uncertainty=min(1.0, uncertainty + 0.05),
                support_score=0.0,
                contradiction_score=0.0,
                rationale=["No new evidence signals were available."],
            )

        support_score = sum(
            signal.weighted_strength()
            for signal in signals
            if signal.direction.lower() == "support"
        )
        contradiction_score = sum(
            signal.weighted_strength()
            for signal in signals
            if signal.direction.lower() == "contradict"
        )

        net_signal = support_score - contradiction_score
        probability_shift = 0.35 * math.tanh(net_signal)
        next_probability = _clamp(previous_probability + probability_shift, 0.01, 0.99)

        total_signal = max(support_score + contradiction_score, 1e-6)
        conflict_ratio = min(support_score, contradiction_score) / total_signal
        corroboration_ratio = support_score / total_signal
        next_uncertainty = _clamp(
            uncertainty + (0.30 * conflict_ratio) - (0.15 * corroboration_ratio),
            0.0,
            1.0,
        )

        next_state = self._derive_state(
            current_state=current_state,
            probability=next_probability,
            support_score=support_score,
            contradiction_score=contradiction_score,
            uncertainty=next_uncertainty,
        )

        rationale = [
            f"Support score={support_score:.3f}.",
            f"Contradiction score={contradiction_score:.3f}.",
            f"Net probability shift={probability_shift:.3f}.",
        ]
        if next_state in {BeliefState.CONTESTED, BeliefState.DEGRADED, BeliefState.RETRACTED}:
            rationale.append("Contradictory evidence exceeded corroboration threshold.")
        if next_state == BeliefState.CORROBORATED:
            rationale.append("Corroborating evidence reached promotion threshold.")

        return BeliefTransition(
            previous_state=current_state,
            next_state=next_state,
            previous_probability=previous_probability,
            next_probability=next_probability,
            uncertainty=next_uncertainty,
            support_score=support_score,
            contradiction_score=contradiction_score,
            rationale=rationale,
        )

    @staticmethod
    def _derive_state(
        *,
        current_state: BeliefState,
        probability: float,
        support_score: float,
        contradiction_score: float,
        uncertainty: float,
    ) -> BeliefState:
        if probability <= 0.12 or contradiction_score >= max(0.6, support_score * 2.0):
            return BeliefState.RETRACTED
        if contradiction_score > support_score * 1.2 and probability < 0.42:
            return BeliefState.DEGRADED
        if contradiction_score > support_score and probability < 0.5:
            return BeliefState.CONTESTED
        if support_score > contradiction_score * 1.4 and probability >= 0.7 and uncertainty <= 0.6:
            return BeliefState.CORROBORATED
        if uncertainty >= 0.85:
            return BeliefState.UNKNOWN
        return current_state
