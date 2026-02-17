import pytest

from src.auth.context import AuthContext, AuthMetadata, AuthType
from src.security.org_policy import OrgSecurityPolicy
from src.security.policy_engine import evaluate_evidence_access


pytestmark = pytest.mark.unit


def _ctx(
    *,
    org_id: str = "org_1",
    scopes: list[str] | None = None,
    is_internal: bool = False,
) -> AuthContext:
    return AuthContext(
        organization_id=org_id,
        auth_subject_id="subject_1",
        scopes=scopes or ["read"],
        metadata=AuthMetadata(
            auth_type=AuthType.INTERNAL_SERVICE if is_internal else AuthType.SESSION,
            user_id="user_1" if not is_internal else None,
            key_id="internal:test" if is_internal else "session:user_1",
        ),
        is_internal=is_internal,
    )


def test_policy_denies_without_read_scope():
    decision = evaluate_evidence_access(
        ctx=_ctx(scopes=["manage:keys"]),
        policy=OrgSecurityPolicy(organization_id="org_1"),
        action="evidence.snippet",
        resource_org_id="org_1",
        resource_sensitivity="sensitive",
        has_break_glass=False,
    )
    assert decision.allowed is False
    assert decision.reason == "read_scope_required"


def test_policy_denies_org_mismatch():
    decision = evaluate_evidence_access(
        ctx=_ctx(org_id="org_a", scopes=["read"]),
        policy=OrgSecurityPolicy(organization_id="org_a"),
        action="evidence.snippet",
        resource_org_id="org_b",
        resource_sensitivity="sensitive",
    )
    assert decision.allowed is False
    assert decision.reason == "organization_mismatch"


def test_policy_requires_break_glass_for_sensitive_full_access():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full",),
    )
    decision = evaluate_evidence_access(
        ctx=_ctx(scopes=["read"]),
        policy=policy,
        action="evidence.full",
        resource_org_id="org_1",
        resource_sensitivity="sensitive",
        has_break_glass=False,
    )
    assert decision.allowed is False
    assert decision.requires_break_glass is True
    assert decision.reason == "break_glass_required"


def test_policy_allows_with_break_glass_override():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        evidence_masking_enabled=True,
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full",),
    )
    decision = evaluate_evidence_access(
        ctx=_ctx(scopes=["read"]),
        policy=policy,
        action="evidence.full",
        resource_org_id="org_1",
        resource_sensitivity="sensitive",
        has_break_glass=True,
    )
    assert decision.allowed is True
    assert decision.masked is False
    assert decision.reason == "allowed"


def test_policy_masks_sensitive_snippet_without_break_glass():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        evidence_masking_enabled=True,
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full",),
    )
    decision = evaluate_evidence_access(
        ctx=_ctx(scopes=["read"]),
        policy=policy,
        action="evidence.snippet",
        resource_org_id="org_1",
        resource_sensitivity="sensitive",
        has_break_glass=False,
    )
    assert decision.allowed is True
    assert decision.masked is True
    assert decision.reason == "allowed_masked"


def test_internal_context_bypasses_break_glass_and_masking():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        evidence_masking_enabled=True,
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full", "evidence.presign"),
    )
    decision = evaluate_evidence_access(
        ctx=_ctx(org_id="internal", scopes=["read", "admin"], is_internal=True),
        policy=policy,
        action="evidence.presign",
        resource_org_id="org_1",
        resource_sensitivity="sensitive",
        has_break_glass=False,
    )
    assert decision.allowed is True
    assert decision.masked is False
    assert decision.reason == "internal_override"
