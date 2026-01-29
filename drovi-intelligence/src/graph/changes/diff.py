"""
Diff Computation

Computes differences between entity versions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import json


class ChangeType(str, Enum):
    """Types of changes."""

    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    UNCHANGED = "unchanged"


@dataclass
class FieldChange:
    """A change to a single field."""

    field_name: str
    change_type: ChangeType
    old_value: Any = None
    new_value: Any = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "field_name": self.field_name,
            "change_type": self.change_type.value,
            "old_value": self._serialize_value(self.old_value),
            "new_value": self._serialize_value(self.new_value),
        }

    def _serialize_value(self, value: Any) -> Any:
        """Serialize value for JSON."""
        if isinstance(value, datetime):
            return value.isoformat()
        if hasattr(value, 'to_dict'):
            return value.to_dict()
        return value


@dataclass
class DiffResult:
    """Result of comparing two entity versions."""

    entity_id: str
    entity_type: str
    old_version: int | None
    new_version: int
    changes: list[FieldChange] = field(default_factory=list)
    is_new: bool = False
    is_deleted: bool = False
    diff_timestamp: datetime = field(default_factory=datetime.utcnow)

    @property
    def has_changes(self) -> bool:
        """Check if there are any changes."""
        return self.is_new or self.is_deleted or len(self.changes) > 0

    @property
    def change_summary(self) -> str:
        """Get a human-readable summary of changes."""
        if self.is_new:
            return f"Created {self.entity_type}"
        if self.is_deleted:
            return f"Deleted {self.entity_type}"

        if not self.changes:
            return "No changes"

        modified_fields = [c.field_name for c in self.changes if c.change_type == ChangeType.MODIFIED]
        added_fields = [c.field_name for c in self.changes if c.change_type == ChangeType.ADDED]
        removed_fields = [c.field_name for c in self.changes if c.change_type == ChangeType.REMOVED]

        parts = []
        if modified_fields:
            parts.append(f"Modified: {', '.join(modified_fields)}")
        if added_fields:
            parts.append(f"Added: {', '.join(added_fields)}")
        if removed_fields:
            parts.append(f"Removed: {', '.join(removed_fields)}")

        return "; ".join(parts)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "old_version": self.old_version,
            "new_version": self.new_version,
            "changes": [c.to_dict() for c in self.changes],
            "is_new": self.is_new,
            "is_deleted": self.is_deleted,
            "change_summary": self.change_summary,
            "diff_timestamp": self.diff_timestamp.isoformat(),
        }


def compute_diff(
    old_data: dict[str, Any] | None,
    new_data: dict[str, Any],
    entity_id: str,
    entity_type: str,
    old_version: int | None = None,
    new_version: int = 1,
    ignore_fields: list[str] | None = None,
) -> DiffResult:
    """
    Compute differences between two entity states.

    Args:
        old_data: Previous entity state (None for new entities)
        new_data: Current entity state
        entity_id: Entity ID
        entity_type: Type of entity
        old_version: Previous version number
        new_version: Current version number
        ignore_fields: Fields to ignore in diff

    Returns:
        DiffResult with all changes
    """
    ignore_fields = ignore_fields or []
    # Always ignore metadata fields
    ignore_fields.extend([
        "updated_at", "last_accessed_at", "version",
        "_id", "_key", "created_at",
    ])

    if old_data is None:
        # New entity
        return DiffResult(
            entity_id=entity_id,
            entity_type=entity_type,
            old_version=None,
            new_version=new_version,
            is_new=True,
        )

    changes = []

    # Get all fields
    all_fields = set(old_data.keys()) | set(new_data.keys())

    for field_name in all_fields:
        if field_name in ignore_fields:
            continue

        old_value = old_data.get(field_name)
        new_value = new_data.get(field_name)

        if field_name not in old_data:
            # Field was added
            changes.append(FieldChange(
                field_name=field_name,
                change_type=ChangeType.ADDED,
                new_value=new_value,
            ))
        elif field_name not in new_data:
            # Field was removed
            changes.append(FieldChange(
                field_name=field_name,
                change_type=ChangeType.REMOVED,
                old_value=old_value,
            ))
        elif not _values_equal(old_value, new_value):
            # Field was modified
            changes.append(FieldChange(
                field_name=field_name,
                change_type=ChangeType.MODIFIED,
                old_value=old_value,
                new_value=new_value,
            ))

    return DiffResult(
        entity_id=entity_id,
        entity_type=entity_type,
        old_version=old_version,
        new_version=new_version,
        changes=changes,
    )


def _values_equal(a: Any, b: Any) -> bool:
    """
    Compare two values for equality.

    Handles special cases like datetime comparison, nested dicts, etc.
    """
    # Handle None
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False

    # Handle datetime
    if isinstance(a, datetime) and isinstance(b, datetime):
        return a == b
    if isinstance(a, datetime):
        try:
            return a == datetime.fromisoformat(str(b).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return False
    if isinstance(b, datetime):
        try:
            return datetime.fromisoformat(str(a).replace("Z", "+00:00")) == b
        except (ValueError, TypeError):
            return False

    # Handle dicts
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_values_equal(a[k], b[k]) for k in a.keys())

    # Handle lists
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        return all(_values_equal(x, y) for x, y in zip(a, b))

    # Default comparison
    return a == b


def compute_batch_diff(
    old_entities: dict[str, dict[str, Any]],
    new_entities: dict[str, dict[str, Any]],
    entity_type: str,
    ignore_fields: list[str] | None = None,
) -> list[DiffResult]:
    """
    Compute diffs for a batch of entities.

    Args:
        old_entities: Map of entity_id -> old data
        new_entities: Map of entity_id -> new data
        entity_type: Type of entities
        ignore_fields: Fields to ignore

    Returns:
        List of DiffResults
    """
    results = []

    all_ids = set(old_entities.keys()) | set(new_entities.keys())

    for entity_id in all_ids:
        old_data = old_entities.get(entity_id)
        new_data = new_entities.get(entity_id)

        if new_data is None:
            # Entity was deleted
            results.append(DiffResult(
                entity_id=entity_id,
                entity_type=entity_type,
                old_version=old_data.get("version", 1) if old_data else None,
                new_version=0,
                is_deleted=True,
            ))
        else:
            diff = compute_diff(
                old_data=old_data,
                new_data=new_data,
                entity_id=entity_id,
                entity_type=entity_type,
                old_version=old_data.get("version", 1) if old_data else None,
                new_version=new_data.get("version", 1),
                ignore_fields=ignore_fields,
            )
            if diff.has_changes:
                results.append(diff)

    return results
