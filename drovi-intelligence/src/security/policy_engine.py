"""RBAC + ABAC policy helpers for evidence access."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.auth.context import AuthContext
from src.auth.scopes import Scope
from src.security.org_policy import OrgSecurityPolicy

EvidenceSensitivity = Literal["normal", "sensitive"]


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    masked: bool
    requires_break_glass: bool
    reason: str


def evaluate_evidence_access(
    *,
    ctx: AuthContext,
    policy: OrgSecurityPolicy,
    action: str,
    resource_org_id: str,
    resource_sensitivity: EvidenceSensitivity = "sensitive",
    has_break_glass: bool = False,
) -> AccessDecision:
    """
    Evaluate access using:
    - RBAC: scope + org binding
    - ABAC: sensitivity + org policy + break-glass override
    """
    if not ctx.has_scope(Scope.READ):
        return AccessDecision(
            allowed=False,
            masked=False,
            requires_break_glass=False,
            reason="read_scope_required",
        )

    if not ctx.is_internal and ctx.organization_id != resource_org_id:
        return AccessDecision(
            allowed=False,
            masked=False,
            requires_break_glass=False,
            reason="organization_mismatch",
        )

    if ctx.is_internal:
        return AccessDecision(
            allowed=True,
            masked=False,
            requires_break_glass=False,
            reason="internal_override",
        )

    sensitive = resource_sensitivity == "sensitive"
    if sensitive and policy.requires_break_glass(action) and not has_break_glass:
        return AccessDecision(
            allowed=False,
            masked=False,
            requires_break_glass=True,
            reason="break_glass_required",
        )

    masked = bool(sensitive and policy.evidence_masking_enabled and not has_break_glass)
    return AccessDecision(
        allowed=True,
        masked=masked,
        requires_break_glass=False,
        reason="allowed_masked" if masked else "allowed",
    )
