"""
Event Types

Defines event types and schemas for the real-time event streaming system.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import json
import uuid


class EventType(str, Enum):
    """Types of events that can be published."""

    # UIO lifecycle events
    UIO_CREATED = "uio.created"
    UIO_UPDATED = "uio.updated"
    UIO_DELETED = "uio.deleted"
    UIO_SUPERSEDED = "uio.superseded"

    # Specific UIO type events
    DECISION_MADE = "decision.made"
    DECISION_REVERSED = "decision.reversed"
    COMMITMENT_CREATED = "commitment.created"
    COMMITMENT_DUE = "commitment.due"
    COMMITMENT_OVERDUE = "commitment.overdue"
    COMMITMENT_FULFILLED = "commitment.fulfilled"
    TASK_CREATED = "task.created"
    TASK_COMPLETED = "task.completed"
    RISK_DETECTED = "risk.detected"
    RISK_RESOLVED = "risk.resolved"

    # Entity events
    ENTITY_CREATED = "entity.created"
    ENTITY_UPDATED = "entity.updated"
    ENTITY_MERGED = "entity.merged"

    # Relationship events
    RELATIONSHIP_CREATED = "relationship.created"
    RELATIONSHIP_UPDATED = "relationship.updated"
    RELATIONSHIP_HEALTH_CHANGED = "relationship.health_changed"

    # Intelligence events
    BRIEF_GENERATED = "brief.generated"
    CONTRADICTION_DETECTED = "contradiction.detected"
    PATTERN_DETECTED = "pattern.detected"
    # World Brain contracts
    OBSERVATION_RAW_V1 = "observation.raw.v1"
    OBSERVATION_NORMALIZED_V1 = "observation.normalized.v1"
    BELIEF_UPDATE_V1 = "belief.update.v1"
    BELIEF_DEGRADED_V1 = "belief.degraded.v1"
    HYPOTHESIS_GENERATED_V1 = "hypothesis.generated.v1"
    HYPOTHESIS_REJECTED_V1 = "hypothesis.rejected.v1"
    CAUSAL_EDGE_UPDATE_V1 = "causal.edge.update.v1"
    IMPACT_EDGE_COMPUTED_V1 = "impact.edge.computed.v1"
    CONSTRAINT_VIOLATION_CANDIDATE_V1 = "constraint.violation.candidate.v1"
    SIMULATION_REQUESTED_V1 = "simulation.requested.v1"
    SIMULATION_COMPLETED_V1 = "simulation.completed.v1"
    INTERVENTION_PROPOSED_V1 = "intervention.proposed.v1"
    OUTCOME_REALIZED_V1 = "outcome.realized.v1"

    # Sync events
    SYNC_STARTED = "sync.started"
    SYNC_COMPLETED = "sync.completed"
    SYNC_FAILED = "sync.failed"

    # System events
    DECAY_COMPUTED = "decay.computed"
    ARCHIVE_TRIGGERED = "archive.triggered"


@dataclass
class Event:
    """An event that can be published to subscribers."""

    event_type: EventType
    organization_id: str
    payload: dict[str, Any]
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=datetime.utcnow)
    correlation_id: str | None = None  # For tracking related events
    source: str | None = None  # Origin of the event (connector, orchestrator, etc.)

    def to_dict(self) -> dict[str, Any]:
        """Convert event to dictionary for serialization."""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "organization_id": self.organization_id,
            "payload": self.payload,
            "timestamp": self.timestamp.isoformat(),
            "correlation_id": self.correlation_id,
            "source": self.source,
        }

    def to_json(self) -> str:
        """Serialize event to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Event":
        """Create event from dictionary."""
        return cls(
            event_id=data["event_id"],
            event_type=EventType(data["event_type"]),
            organization_id=data["organization_id"],
            payload=data["payload"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            correlation_id=data.get("correlation_id"),
            source=data.get("source"),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "Event":
        """Deserialize event from JSON string."""
        return cls.from_dict(json.loads(json_str))


# Channel naming conventions
def get_channel_name(organization_id: str, event_type: EventType | None = None) -> str:
    """
    Get Redis channel name for an organization and optional event type.

    Examples:
        - "drovi:events:org123" - All events for org123
        - "drovi:events:org123:uio.created" - Only UIO created events for org123
    """
    base = f"drovi:events:{organization_id}"
    if event_type:
        return f"{base}:{event_type.value}"
    return base


def get_broadcast_channel(event_type: EventType | None = None) -> str:
    """
    Get broadcast channel for system-wide events.

    Examples:
        - "drovi:events:broadcast" - All broadcast events
        - "drovi:events:broadcast:sync.completed" - Only sync completed events
    """
    base = "drovi:events:broadcast"
    if event_type:
        return f"{base}:{event_type.value}"
    return base


def is_world_brain_event_type(event_type: EventType | str) -> bool:
    """Return True when event type is part of the versioned World Brain contract set."""
    value = event_type.value if isinstance(event_type, EventType) else str(event_type)
    return value.endswith(".v1")


def get_world_brain_event_types() -> list[EventType]:
    """Return all world-brain contract event types."""
    return [event_type for event_type in EventType if is_world_brain_event_type(event_type)]
