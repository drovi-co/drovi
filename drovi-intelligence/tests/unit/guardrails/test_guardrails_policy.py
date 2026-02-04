from src.guardrails.policy import PolicyContext, PolicyRule, evaluate_policy


def test_policy_blocks_critical_action_without_admin():
    rule = PolicyRule(
        id="block_critical",
        name="Block Critical",
        action="block",
        severity="critical",
        applies_to="outbound",
        conditions=[
            {"field": "action_tier", "operator": "equals", "value": "critical"},
            {"field": "actor_role", "operator": "not_in", "value": ["admin"]},
        ],
    )

    context = PolicyContext(
        direction="outbound",
        channel="email",
        pii_types=[],
        contradiction_severity=None,
        fraud_score=None,
        actor_role="member",
        sensitivity=None,
        action_tier="critical",
        action_type="email.send",
    )

    decisions = evaluate_policy(context, rules=[rule])
    assert decisions
    assert decisions[0].action == "block"

    admin_context = PolicyContext(
        direction="outbound",
        channel="email",
        pii_types=[],
        contradiction_severity=None,
        fraud_score=None,
        actor_role="admin",
        sensitivity=None,
        action_tier="critical",
        action_type="email.send",
    )

    decisions = evaluate_policy(admin_context, rules=[rule])
    assert decisions == []


def test_policy_requires_approval_for_sensitive_actions():
    rule = PolicyRule(
        id="require_sensitive",
        name="Require Approval",
        action="require_approval",
        severity="high",
        applies_to="outbound",
        conditions=[{"field": "sensitivity", "operator": "in", "value": ["restricted"]}],
    )

    context = PolicyContext(
        direction="outbound",
        channel="slack",
        pii_types=[],
        contradiction_severity=None,
        fraud_score=None,
        actor_role="admin",
        sensitivity="restricted",
        action_tier="high",
        action_type="slack.post",
    )

    decisions = evaluate_policy(context, rules=[rule])
    assert decisions
    assert decisions[0].action == "require_approval"
