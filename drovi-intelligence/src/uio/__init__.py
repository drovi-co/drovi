"""
UIO (Universal Intelligence Object) Management

Provides lifecycle management for all intelligence objects:
- Commitments, Decisions, Tasks, Claims
- Status tracking (draft → active → completed → archived)
- Tri-store sync (PostgreSQL + FalkorDB + Graphiti)
- User corrections and merge handling
"""

from .manager import UIOManager, get_uio_manager
from .sync import UIOSync, get_uio_sync

__all__ = [
    "UIOManager",
    "get_uio_manager",
    "UIOSync",
    "get_uio_sync",
]
