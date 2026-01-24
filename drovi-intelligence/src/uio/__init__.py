"""
UIO (Universal Intelligence Object) Management

Provides lifecycle management for all intelligence objects:
- Commitments, Decisions, Tasks, Claims, Risks, Briefs
- Status tracking (draft → active → completed → archived)
- Tri-store sync (PostgreSQL + FalkorDB + Graphiti)
- User corrections and merge handling
- Type-specific extension tables
"""

from .manager import UIOManager, get_uio_manager
from .schemas import (
    # Enums
    UIOType,
    UIOStatus,
    CommitmentDirection,
    CommitmentPriority,
    CommitmentStatus,
    DecisionStatus,
    TaskStatus,
    TaskPriority,
    RiskType,
    RiskSeverity,
    BriefAction,
    BriefPriority,
    ClaimType,
    ClaimImportance,
    # Base schemas
    SourceContext,
    UIOBase,
    UIOCreate,
    # Extension details
    CommitmentDetailsCreate,
    DecisionDetailsCreate,
    ClaimDetailsCreate,
    TaskDetailsCreate,
    RiskDetailsCreate,
    BriefDetailsCreate,
    # Create requests
    CreateCommitmentUIO,
    CreateDecisionUIO,
    CreateClaimUIO,
    CreateTaskUIO,
    CreateRiskUIO,
    CreateBriefUIO,
)
from .sync import UIOSync, get_uio_sync

__all__ = [
    # Manager
    "UIOManager",
    "get_uio_manager",
    # Sync
    "UIOSync",
    "get_uio_sync",
    # Enums
    "UIOType",
    "UIOStatus",
    "CommitmentDirection",
    "CommitmentPriority",
    "CommitmentStatus",
    "DecisionStatus",
    "TaskStatus",
    "TaskPriority",
    "RiskType",
    "RiskSeverity",
    "BriefAction",
    "BriefPriority",
    "ClaimType",
    "ClaimImportance",
    # Base schemas
    "SourceContext",
    "UIOBase",
    "UIOCreate",
    # Extension details
    "CommitmentDetailsCreate",
    "DecisionDetailsCreate",
    "ClaimDetailsCreate",
    "TaskDetailsCreate",
    "RiskDetailsCreate",
    "BriefDetailsCreate",
    # Create requests
    "CreateCommitmentUIO",
    "CreateDecisionUIO",
    "CreateClaimUIO",
    "CreateTaskUIO",
    "CreateRiskUIO",
    "CreateBriefUIO",
]
