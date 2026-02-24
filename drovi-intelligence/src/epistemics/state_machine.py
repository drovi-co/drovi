"""Deterministic epistemic belief-state machine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from src.epistemics.engine import BeliefState


_ALLOWED_TRANSITIONS: Final[dict[BeliefState, set[BeliefState]]] = {
    BeliefState.ASSERTED: {
        BeliefState.ASSERTED,
        BeliefState.CORROBORATED,
        BeliefState.CONTESTED,
        BeliefState.DEGRADED,
        BeliefState.RETRACTED,
        BeliefState.UNKNOWN,
    },
    BeliefState.CORROBORATED: {
        BeliefState.CORROBORATED,
        BeliefState.CONTESTED,
        BeliefState.DEGRADED,
        BeliefState.RETRACTED,
        BeliefState.UNKNOWN,
    },
    BeliefState.CONTESTED: {
        BeliefState.CONTESTED,
        BeliefState.DEGRADED,
        BeliefState.RETRACTED,
        BeliefState.CORROBORATED,
        BeliefState.UNKNOWN,
    },
    BeliefState.DEGRADED: {
        BeliefState.DEGRADED,
        BeliefState.CONTESTED,
        BeliefState.RETRACTED,
        BeliefState.CORROBORATED,
        BeliefState.UNKNOWN,
    },
    BeliefState.RETRACTED: {
        BeliefState.RETRACTED,
        BeliefState.UNKNOWN,
        BeliefState.ASSERTED,
    },
    BeliefState.UNKNOWN: {
        BeliefState.UNKNOWN,
        BeliefState.ASSERTED,
        BeliefState.CONTESTED,
        BeliefState.CORROBORATED,
        BeliefState.DEGRADED,
    },
}


@dataclass(slots=True)
class TransitionDecision:
    current: BeliefState
    proposed: BeliefState
    next_state: BeliefState
    is_valid: bool
    reason: str


class EpistemicStateMachine:
    """Validates and normalizes belief-state transitions."""

    @staticmethod
    def coerce(value: str | BeliefState | None) -> BeliefState:
        if isinstance(value, BeliefState):
            return value
        if value is None:
            return BeliefState.ASSERTED
        try:
            return BeliefState(str(value).strip().lower())
        except ValueError:
            return BeliefState.ASSERTED

    @staticmethod
    def is_allowed(current: BeliefState, proposed: BeliefState) -> bool:
        return proposed in _ALLOWED_TRANSITIONS.get(current, {current})

    def resolve(
        self,
        *,
        current: BeliefState,
        proposed: BeliefState,
        contradiction_hits: int = 0,
    ) -> TransitionDecision:
        if contradiction_hits > 0 and proposed in {BeliefState.ASSERTED, BeliefState.CORROBORATED}:
            return TransitionDecision(
                current=current,
                proposed=proposed,
                next_state=BeliefState.CONTESTED,
                is_valid=True,
                reason="contradiction_override",
            )

        if self.is_allowed(current, proposed):
            return TransitionDecision(
                current=current,
                proposed=proposed,
                next_state=proposed,
                is_valid=True,
                reason="allowed_transition",
            )

        return TransitionDecision(
            current=current,
            proposed=proposed,
            next_state=current,
            is_valid=False,
            reason="invalid_transition_blocked",
        )
