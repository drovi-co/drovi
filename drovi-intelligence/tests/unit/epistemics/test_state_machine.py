from src.epistemics import BeliefState, EpistemicStateMachine


def test_state_machine_blocks_invalid_recovery_from_retracted_to_corroborated() -> None:
    machine = EpistemicStateMachine()

    decision = machine.resolve(
        current=BeliefState.RETRACTED,
        proposed=BeliefState.CORROBORATED,
        contradiction_hits=0,
    )

    assert decision.is_valid is False
    assert decision.next_state == BeliefState.RETRACTED
    assert decision.reason == "invalid_transition_blocked"


def test_state_machine_overrides_to_contested_on_contradictions() -> None:
    machine = EpistemicStateMachine()

    decision = machine.resolve(
        current=BeliefState.CORROBORATED,
        proposed=BeliefState.CORROBORATED,
        contradiction_hits=2,
    )

    assert decision.is_valid is True
    assert decision.next_state == BeliefState.CONTESTED
    assert decision.reason == "contradiction_override"
