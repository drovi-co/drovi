"""
Change Detection Module

Provides entity versioning, change tracking, and diff computation.
"""

from src.graph.changes.tracker import (
    ChangeTracker,
    get_change_tracker,
)
from src.graph.changes.diff import (
    ChangeType,
    DiffResult,
    FieldChange,
    compute_diff,
)
from src.graph.changes.version import (
    EntityVersion,
    VersionManager,
)

__all__ = [
    "ChangeTracker",
    "ChangeType",
    "get_change_tracker",
    "DiffResult",
    "FieldChange",
    "compute_diff",
    "EntityVersion",
    "VersionManager",
]
