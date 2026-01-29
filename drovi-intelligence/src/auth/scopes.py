"""
API Scope definitions for Drovi Intelligence API.

Scopes control what operations an API key can perform.
"""

from enum import Enum


class Scope(str, Enum):
    """API permission scopes."""

    # Read scopes
    READ = "read"  # Read UIOs, search, view contacts
    READ_GRAPH = "read:graph"  # Read graph data
    READ_ANALYTICS = "read:analytics"  # Read analytics data

    # Write scopes
    WRITE = "write"  # Create/update UIOs, analyze content
    WRITE_GRAPH = "write:graph"  # Modify graph data
    WRITE_CONNECTIONS = "write:connections"  # Manage connections

    # Admin scopes
    ADMIN = "admin"  # Full access
    MANAGE_KEYS = "manage:keys"  # Create/revoke API keys

    # Special scopes
    INTERNAL = "internal"  # Internal Drovi app (all access)
    MCP = "mcp"  # MCP tool access


# Scope hierarchies - higher scopes include lower ones
SCOPE_HIERARCHY = {
    Scope.ADMIN: [
        Scope.READ,
        Scope.READ_GRAPH,
        Scope.READ_ANALYTICS,
        Scope.WRITE,
        Scope.WRITE_GRAPH,
        Scope.WRITE_CONNECTIONS,
        Scope.MANAGE_KEYS,
        Scope.MCP,
    ],
    Scope.INTERNAL: [
        Scope.READ,
        Scope.READ_GRAPH,
        Scope.READ_ANALYTICS,
        Scope.WRITE,
        Scope.WRITE_GRAPH,
        Scope.WRITE_CONNECTIONS,
        Scope.MANAGE_KEYS,
        Scope.MCP,
        Scope.ADMIN,
    ],
    Scope.WRITE: [Scope.READ],
    Scope.WRITE_GRAPH: [Scope.READ_GRAPH],
    Scope.WRITE_CONNECTIONS: [Scope.READ],
}


def has_scope(granted_scopes: list[str], required_scope: str) -> bool:
    """
    Check if granted scopes include the required scope.

    Handles scope hierarchy - e.g., ADMIN includes all scopes.

    Args:
        granted_scopes: List of granted scope strings
        required_scope: Required scope string

    Returns:
        True if scope is granted
    """
    # Wildcard grants all
    if "*" in granted_scopes:
        return True

    # Direct match
    if required_scope in granted_scopes:
        return True

    # Check hierarchy
    for granted in granted_scopes:
        try:
            granted_enum = Scope(granted)
            if granted_enum in SCOPE_HIERARCHY:
                implied = SCOPE_HIERARCHY[granted_enum]
                if required_scope in [s.value for s in implied]:
                    return True
        except ValueError:
            continue

    return False


def get_default_scopes() -> list[str]:
    """Get default scopes for new API keys."""
    return [Scope.READ.value, Scope.WRITE.value, Scope.MCP.value]


def get_all_scopes() -> list[str]:
    """Get all available scopes."""
    return [s.value for s in Scope]
