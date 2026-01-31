"""
Unified Authentication Context for Drovi Intelligence API.

Provides a single AuthContext class that works for all authentication methods:
- Session cookies (Pilot Surface frontend)
- Internal service tokens (internal services)
- API keys (external integrations)

This replaces the fragmented APIKeyContext with a unified model that:
- Uses role-based scopes for session users (not wildcard ["*"])
- Requires X-Organization-ID header for internal service tokens
- Provides comprehensive audit metadata
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Literal

from src.auth.scopes import Scope, has_scope


class AuthType(str, Enum):
    """Type of authentication used."""

    SESSION = "session"
    INTERNAL_SERVICE = "internal_service"
    API_KEY = "api_key"


@dataclass
class AuthMetadata:
    """
    Audit metadata about how the request was authenticated.

    This provides comprehensive information for logging and debugging.
    """

    auth_type: AuthType
    user_email: str | None = None
    user_id: str | None = None
    key_name: str | None = None
    key_id: str | None = None
    service_name: str | None = None
    authenticated_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        """Convert to dict for logging/audit."""
        return {
            "auth_type": self.auth_type.value,
            "user_email": self.user_email,
            "user_id": self.user_id,
            "key_name": self.key_name,
            "key_id": self.key_id,
            "service_name": self.service_name,
            "authenticated_at": self.authenticated_at.isoformat() if self.authenticated_at else None,
        }


# Role to scopes mapping for session users
ROLE_SCOPES = {
    "pilot_admin": [
        Scope.ADMIN.value,
        Scope.READ.value,
        Scope.WRITE.value,
        Scope.READ_GRAPH.value,
        Scope.WRITE_GRAPH.value,
        Scope.READ_ANALYTICS.value,
        Scope.WRITE_CONNECTIONS.value,
        Scope.MANAGE_KEYS.value,
        Scope.MCP.value,
    ],
    "pilot_member": [
        Scope.READ.value,
        Scope.WRITE.value,
        Scope.READ_GRAPH.value,
        Scope.WRITE_CONNECTIONS.value,
        Scope.MCP.value,
    ],
    "pilot_viewer": [
        Scope.READ.value,
        Scope.READ_GRAPH.value,
    ],
}


def get_scopes_for_role(role: str) -> list[str]:
    """
    Get scopes for a given role.

    Args:
        role: User role (pilot_admin, pilot_member, pilot_viewer)

    Returns:
        List of scope strings for this role
    """
    return ROLE_SCOPES.get(role, [Scope.READ.value])


class AuthContext:
    """
    Unified authentication context for all auth methods.

    This replaces the fragmented APIKeyContext with a single model that:
    - Contains immutable organization_id (extracted from JWT/API key, not request)
    - Uses role-based scopes for session users
    - Provides comprehensive audit metadata
    - Supports rate limiting configuration

    Usage:
        @router.get("/resource")
        async def get_resource(
            auth: AuthContext = Depends(get_auth_context),
        ):
            org_id = auth.organization_id  # Immutable, trusted
            if auth.has_scope(Scope.WRITE):
                ...
    """

    def __init__(
        self,
        organization_id: str,
        auth_subject_id: str,
        scopes: list[str],
        metadata: AuthMetadata,
        rate_limit_per_minute: int = 100,
        is_internal: bool = False,
    ):
        """
        Initialize AuthContext.

        Args:
            organization_id: The organization ID (immutable, from JWT/API key)
            auth_subject_id: Unique identifier for the auth subject
                            (e.g., "user_123", "service_internal", "key_abc")
            scopes: List of granted scope strings
            metadata: Audit metadata about how the request was authenticated
            rate_limit_per_minute: Rate limit for this context
            is_internal: Whether this is an internal service
        """
        self._organization_id = organization_id
        self._auth_subject_id = auth_subject_id
        self._scopes = scopes
        self._metadata = metadata
        self._rate_limit_per_minute = rate_limit_per_minute
        self._is_internal = is_internal

    @property
    def organization_id(self) -> str:
        """Organization ID (immutable, from JWT/API key)."""
        return self._organization_id

    @property
    def auth_subject_id(self) -> str:
        """Unique identifier for the auth subject."""
        return self._auth_subject_id

    @property
    def scopes(self) -> list[str]:
        """List of granted scope strings."""
        return self._scopes

    @property
    def metadata(self) -> AuthMetadata:
        """Audit metadata about how the request was authenticated."""
        return self._metadata

    @property
    def rate_limit_per_minute(self) -> int:
        """Rate limit for this context."""
        return self._rate_limit_per_minute

    @property
    def is_internal(self) -> bool:
        """Whether this is an internal service."""
        return self._is_internal

    # Convenience properties from metadata
    @property
    def user_id(self) -> str | None:
        """User ID if session auth."""
        return self._metadata.user_id

    @property
    def user_email(self) -> str | None:
        """User email if session auth."""
        return self._metadata.user_email

    @property
    def auth_type(self) -> AuthType:
        """Type of authentication used."""
        return self._metadata.auth_type

    def has_scope(self, scope: str | Scope) -> bool:
        """
        Check if this context has the required scope.

        Uses the scope hierarchy - e.g., ADMIN includes all scopes.

        Args:
            scope: Required scope (string or Scope enum)

        Returns:
            True if scope is granted
        """
        scope_str = scope.value if isinstance(scope, Scope) else scope
        return has_scope(self._scopes, scope_str)

    def require_scope(self, scope: str | Scope) -> None:
        """
        Require a scope, raising HTTPException if not granted.

        Args:
            scope: Required scope (string or Scope enum)

        Raises:
            HTTPException: If scope is not granted
        """
        from fastapi import HTTPException

        if not self.has_scope(scope):
            scope_str = scope.value if isinstance(scope, Scope) else scope
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required scope: {scope_str}",
            )

    def to_audit_log(self) -> dict:
        """
        Convert to dict for audit logging.

        Returns comprehensive information for debugging and compliance.
        """
        return {
            "organization_id": self._organization_id,
            "auth_subject_id": self._auth_subject_id,
            "auth_type": self._metadata.auth_type.value,
            "scopes": self._scopes,
            "rate_limit": self._rate_limit_per_minute,
            "is_internal": self._is_internal,
            **self._metadata.to_dict(),
        }

    def __repr__(self) -> str:
        return (
            f"AuthContext(org={self._organization_id}, "
            f"subject={self._auth_subject_id}, "
            f"type={self._metadata.auth_type.value})"
        )
