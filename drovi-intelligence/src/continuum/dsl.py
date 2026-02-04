"""Continuum DSL - goals, constraints, escalation, and proofs."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError


class ContinuumSchedule(BaseModel):
    """Scheduling specification for a Continuum."""

    type: Literal["interval", "cron", "on_demand"] = "interval"
    interval_minutes: int | None = Field(default=60, ge=1)
    cron: str | None = None


class ContinuumConstraint(BaseModel):
    """A constraint that must be satisfied before execution."""

    type: str
    expression: str
    required: bool = True


class ContinuumProof(BaseModel):
    """Proof requirements for an execution or step."""

    type: str
    criteria: str
    min_confidence: float | None = Field(default=None, ge=0, le=1)


class ContinuumEscalationPolicy(BaseModel):
    """Escalation and override policy."""

    on_failure: bool = True
    max_retries: int = Field(default=2, ge=0, le=10)
    notify_on_failure: bool = True
    notify_on_escalation: bool = True
    require_manual_override: bool = True
    policy_checks: bool = True
    channels: list[str] = Field(default_factory=lambda: ["email"])


class ContinuumStep(BaseModel):
    """A step in the Continuum execution plan."""

    id: str
    name: str
    action: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    requires: list[str] = Field(default_factory=list)
    proof: ContinuumProof | None = None
    policy_context: dict[str, Any] | None = None


class ContinuumDefinition(BaseModel):
    """Full Continuum definition."""

    name: str
    goal: str
    schedule: ContinuumSchedule = Field(default_factory=ContinuumSchedule)
    constraints: list[ContinuumConstraint] = Field(default_factory=list)
    steps: list[ContinuumStep]
    proofs: list[ContinuumProof] = Field(default_factory=list)
    escalation: ContinuumEscalationPolicy = Field(default_factory=ContinuumEscalationPolicy)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: str | dict[str, Any]) -> "ContinuumDefinition":
        """Parse a Continuum definition from JSON/YAML-like payload."""
        if isinstance(payload, dict):
            return cls.model_validate(payload)

        raw = payload.strip()
        if raw.startswith("{"):
            return cls.model_validate(json.loads(raw))

        try:
            import yaml  # type: ignore

            return cls.model_validate(yaml.safe_load(raw))
        except Exception as exc:
            raise ValidationError.from_exception_data(
                title="ContinuumDefinition",
                line_errors=[
                    {
                        "type": "value_error",
                        "loc": ("payload",),
                        "msg": f"Failed to parse Continuum DSL: {exc}",
                        "input": payload,
                    }
                ],
            )


def compute_definition_hash(definition: ContinuumDefinition) -> str:
    """Generate a deterministic hash for a Continuum definition."""
    raw = json.dumps(definition.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.utcnow()
