"""Actuation models and enums."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ActionPhase(str, Enum):
    READ = "read"
    DRAFT = "draft"
    STAGE = "stage"
    EXECUTE = "execute"
    ROLLBACK = "rollback"


class ActionStatus(str, Enum):
    DRAFTED = "drafted"
    STAGED = "staged"
    EXECUTED = "executed"
    FAILED = "failed"
    BLOCKED = "blocked"
    REQUIRES_APPROVAL = "requires_approval"
    SANDBOXED = "sandboxed"
    ROLLED_BACK = "rolled_back"


class ActionTier(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ActuationRequest(BaseModel):
    organization_id: str
    driver: str
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)
    tier: ActionTier | None = None
    policy_context: dict[str, Any] | None = None
    actor_id: str | None = None
    approval_by: str | None = None
    approval_reason: str | None = None
    force_execute: bool = False


class ActuationRecord(BaseModel):
    id: str
    organization_id: str
    driver: str
    action_type: str
    tier: ActionTier
    status: ActionStatus
    input_payload: dict[str, Any]
    draft_payload: dict[str, Any] | None = None
    stage_payload: dict[str, Any] | None = None
    result_payload: dict[str, Any] | None = None
    rollback_payload: dict[str, Any] | None = None
    rollback_result: dict[str, Any] | None = None
    policy_decisions: list[dict[str, Any]] = Field(default_factory=list)
    created_by: str | None = None
    approval_by: str | None = None
    approval_reason: str | None = None
    error_message: str | None = None
