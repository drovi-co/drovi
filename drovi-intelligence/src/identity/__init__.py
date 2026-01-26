"""
Contact Identity Resolution Module

Provides cross-source identity linking and contact resolution for the
Contact-First Intelligence System.
"""

from .resolution_engine import (
    UnifiedIdentityGraph,
    get_identity_graph,
    ResolvedIdentity,
    MergeSuggestion,
    IdentityMatch,
)
from .types import (
    IdentityType,
    IdentitySource,
    Identity,
    ContactContext,
    ResolvedContact,
)

__all__ = [
    "UnifiedIdentityGraph",
    "get_identity_graph",
    "ResolvedIdentity",
    "MergeSuggestion",
    "IdentityMatch",
    "IdentityType",
    "IdentitySource",
    "Identity",
    "ContactContext",
    "ResolvedContact",
]
