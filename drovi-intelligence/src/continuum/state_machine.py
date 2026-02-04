"""Continuum lifecycle state machine."""

from __future__ import annotations

from src.continuum.models import ContinuumStatus


ALLOWED_TRANSITIONS: dict[ContinuumStatus, set[ContinuumStatus]] = {
    ContinuumStatus.DRAFT: {ContinuumStatus.ACTIVE, ContinuumStatus.CANCELLED},
    ContinuumStatus.ACTIVE: {
        ContinuumStatus.PAUSED,
        ContinuumStatus.COMPLETED,
        ContinuumStatus.FAILED,
        ContinuumStatus.ESCALATED,
        ContinuumStatus.CANCELLED,
    },
    ContinuumStatus.PAUSED: {ContinuumStatus.ACTIVE, ContinuumStatus.CANCELLED},
    ContinuumStatus.ESCALATED: {ContinuumStatus.ACTIVE, ContinuumStatus.CANCELLED},
    ContinuumStatus.FAILED: {ContinuumStatus.ACTIVE, ContinuumStatus.CANCELLED},
    ContinuumStatus.COMPLETED: {ContinuumStatus.ACTIVE},
    ContinuumStatus.CANCELLED: set(),
}


def can_transition(current: ContinuumStatus, target: ContinuumStatus) -> bool:
    """Return True if the transition is allowed."""
    if current == target:
        return True
    return target in ALLOWED_TRANSITIONS.get(current, set())


def require_transition(current: ContinuumStatus, target: ContinuumStatus) -> None:
    """Raise ValueError if transition is not allowed."""
    if not can_transition(current, target):
        raise ValueError(f"Invalid Continuum transition: {current.value} -> {target.value}")
