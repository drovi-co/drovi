"""Agentic Memory System - Canonical memory service with optional adapters."""

from .drovi_memory import DroviMemory, get_memory
from .service import MemoryService, get_memory_service
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
    # Canonical memory service (preferred)
    "MemoryService",
    "get_memory_service",
    # New Graphiti-based memory (recommended)
    "DroviGraphitiMemory",
    "get_graphiti_memory",
    "close_all_graphiti_connections",
    # Enhanced Graphiti with temporal queries
    "EnhancedGraphiti",
    "get_enhanced_graphiti",
    "close_all_enhanced_graphiti",
]
