"""Continuum runtime models and enums."""

from __future__ import annotations

from enum import Enum


class ContinuumStatus(str, Enum):
    """High-level lifecycle status for a Continuum."""

    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    ESCALATED = "escalated"
    CANCELLED = "cancelled"


class ContinuumRunStatus(str, Enum):
    """Status for a single Continuum execution run."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ESCALATED = "escalated"
    CANCELLED = "cancelled"


class ContinuumAlertType(str, Enum):
    """Alert types emitted by the Continuum runtime."""

    ESCALATION = "escalation"
    STUCK = "stuck"
    DEGRADED = "degraded"
    FAILURE = "failure"


class ContinuumAlertStatus(str, Enum):
    """Alert status for Continuum monitoring."""

    OPEN = "open"
    RESOLVED = "resolved"
