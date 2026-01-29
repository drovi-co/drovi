"""Agentic Memory System - Graphiti-powered temporal memory."""

from .drovi_memory import DroviMemory, get_memory
from .graphiti_memory import (
    DroviGraphitiMemory,
    get_graphiti_memory,
    close_all_graphiti_connections,
)
from .graphiti_enhanced import (
    EnhancedGraphiti,
    get_enhanced_graphiti,
    close_all_enhanced_graphiti,
)

__all__ = [
    # Legacy custom memory (kept for backward compatibility)
    "DroviMemory",
    "get_memory",
    # New Graphiti-based memory (recommended)
    "DroviGraphitiMemory",
    "get_graphiti_memory",
    "close_all_graphiti_connections",
    # Enhanced Graphiti with temporal queries
    "EnhancedGraphiti",
    "get_enhanced_graphiti",
    "close_all_enhanced_graphiti",
]
