"""Policy and redaction helpers for cognitive endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from src.auth.context import AuthContext
from src.compliance.dlp import sanitize_text
from src.security.break_glass import validate_break_glass_token
from src.security.org_policy import get_org_security_policy
from src.security.policy_engine import AccessDecision, evaluate_evidence_access


def _sanitize(value: str | None) -> str | None:
    if value is None:
        return None
    masked, _ = sanitize_text(value)
    return masked


def redact_payload(value: Any) -> Any:
    """Recursively DLP-redact string leaves in a payload."""
    if isinstance(value, str):
        return _sanitize(value)
    if isinstance(value, list):
        return [redact_payload(item) for item in value]
    if isinstance(value, tuple):
        return [redact_payload(item) for item in value]
    if isinstance(value, dict):
        return {str(key): redact_payload(item) for key, item in value.items()}
    return value


async def require_cognitive_access(
    *,
    ctx: AuthContext,
    organization_id: str,
    action: str,
    break_glass_token: str | None = None,
    sensitivity: str = "sensitive",
) -> AccessDecision:
    """
    Evaluate cognitive evidence access using org policy + break-glass grants.

    Returns:
        AccessDecision with `masked=True` when payload should be redacted.
    """
    policy = await get_org_security_policy(organization_id)
    grant = await validate_break_glass_token(
        organization_id=organization_id,
        token=break_glass_token if isinstance(break_glass_token, str) else None,
        scope=action,
    )
    decision = evaluate_evidence_access(
        ctx=ctx,
        policy=policy,
        action=action,
        resource_org_id=organization_id,
        resource_sensitivity="sensitive" if sensitivity == "sensitive" else "normal",
        has_break_glass=grant is not None,
    )
    if decision.allowed:
        return decision

    detail = (
        "Break-glass token required for this cognitive evidence path"
        if decision.requires_break_glass
        else "Access denied"
    )
    raise HTTPException(status_code=403, detail=detail)
