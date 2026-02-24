from src.intervention import InterventionEngine, PolicyClass


def test_propose_creates_governed_plan_with_rollback() -> None:
    engine = InterventionEngine()
    candidate = engine.propose(
        target_ref="entity_1",
        pressure_score=0.85,
        causal_confidence=0.6,
        max_constraint_severity="high",
        recommended_actions=["pause campaign", "notify compliance"],
    )

    assert candidate.policy_class in {PolicyClass.P0_FREEZE, PolicyClass.P1_HUMAN_APPROVAL}
    assert candidate.requires_human_approval
    assert candidate.action_steps
    assert candidate.action_edges
    assert candidate.policy_gates
    assert candidate.rollback_steps
    assert candidate.rollback_verification is not None
    assert candidate.rollback_verification.is_verified
    assert candidate.approval_class == "human"
    payload = candidate.to_dict()
    assert payload["action_graph"]["nodes"]
    assert payload["action_graph"]["edges"]
    assert payload["rollback_verification"]["is_verified"] is True
