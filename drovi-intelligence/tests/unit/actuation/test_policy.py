from src.actuation.models import ActionTier
from src.actuation.service import (
    _build_policy_decisions,
    _policy_blocks,
    _policy_requires_approval,
    _requires_approval_for_tier,
)


def test_requires_approval_for_tier():
    assert _requires_approval_for_tier(ActionTier.HIGH) is True
    assert _requires_approval_for_tier(ActionTier.CRITICAL) is True
    assert _requires_approval_for_tier(ActionTier.MEDIUM) is False


def test_policy_decisions_block():
    decisions = _build_policy_decisions(
        {
            "direction": "outbound",
            "pii_types": ["ssn"],
        }
    )
    assert _policy_blocks(decisions) is True


def test_policy_requires_approval():
    decisions = _build_policy_decisions(
        {
            "direction": "outbound",
            "pii_types": ["email"],
        }
    )
    assert _policy_requires_approval(decisions) is True
