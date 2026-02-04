"""Base driver interfaces for actuation."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field

from src.actuation.models import ActionTier


class DriverContext(BaseModel):
    organization_id: str
    actor_id: str | None = None
    correlation_id: str | None = None


class DriverResult(BaseModel):
    status: str
    detail: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    rollback_payload: dict[str, Any] | None = None


class ActuatorDriver(ABC):
    """Actuation driver interface."""

    name: str
    default_tier: ActionTier = ActionTier.MEDIUM

    @abstractmethod
    async def draft(self, context: DriverContext, payload: dict[str, Any]) -> dict[str, Any]:
        """Create a draft action payload."""

    @abstractmethod
    async def stage(self, context: DriverContext, draft: dict[str, Any]) -> dict[str, Any]:
        """Stage the action, validating inputs and applying policy checks."""

    @abstractmethod
    async def execute(self, context: DriverContext, staged: dict[str, Any]) -> DriverResult:
        """Execute the action and return result + rollback payload."""

    async def rollback(self, context: DriverContext, rollback_payload: dict[str, Any]) -> DriverResult:
        """Rollback a previously executed action."""
        return DriverResult(status="noop", detail="Rollback not supported")

    async def read(self, context: DriverContext, payload: dict[str, Any]) -> DriverResult:
        """Optional read operation."""
        return DriverResult(status="noop", detail="Read not supported")
