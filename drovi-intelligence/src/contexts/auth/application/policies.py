"""
Auth policies (application layer).

This module centralizes authorization checks so they are:
- Explicit and testable.
- Reusable across contexts/routes.
- Independent from FastAPI specifics (raises typed kernel errors).
"""

from __future__ import annotations

from src.auth.context import AuthContext
from src.auth.scopes import Scope
from src.kernel.errors import ForbiddenError


def require_org_access(ctx: AuthContext, organization_id: str) -> None:
    """
    Ensure the authenticated subject is bound to `organization_id`.

    Internal/admin callers may operate across orgs via explicit "internal" mode.
    """
    if ctx.organization_id == "internal":
        return
    if organization_id != ctx.organization_id:
        raise ForbiddenError(
            message="Organization ID mismatch",
            meta={"requested_organization_id": organization_id},
        )


def require_admin(ctx: AuthContext) -> None:
    """Require admin capability."""
    if ctx.is_internal:
        return
    if ctx.has_scope(Scope.ADMIN):
        return
    raise ForbiddenError(message="Admin scope required")


def require_internal(ctx: AuthContext) -> None:
    """Require an internal service subject."""
    if ctx.is_internal:
        return
    raise ForbiddenError(message="Internal service access required")

