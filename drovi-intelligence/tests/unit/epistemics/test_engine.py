from src.epistemics import BeliefState, EpistemicEngine, EvidenceSignal


def test_transition_promotes_to_corroborated_on_strong_support() -> None:
    engine = EpistemicEngine()
    transition = engine.transition(
        current_state=BeliefState.ASSERTED,
        current_probability=0.58,
        prior_uncertainty=0.4,
        signals=[
            EvidenceSignal(direction="support", strength=0.9, reliability=0.9, freshness_hours=2),
            EvidenceSignal(direction="support", strength=0.8, reliability=0.85, freshness_hours=5),
        ],
    )

    assert transition.next_state == BeliefState.CORROBORATED
    assert transition.next_probability > transition.previous_probability
    assert transition.uncertainty < 0.4


def test_transition_degrades_on_contradictory_evidence() -> None:
    engine = EpistemicEngine()
    transition = engine.transition(
        current_state=BeliefState.CORROBORATED,
        current_probability=0.82,
        prior_uncertainty=0.2,
        signals=[
            EvidenceSignal(direction="contradict", strength=0.95, reliability=0.9, freshness_hours=1),
            EvidenceSignal(direction="contradict", strength=0.85, reliability=0.8, freshness_hours=3),
        ],
    )

    assert transition.next_state in {BeliefState.DEGRADED, BeliefState.RETRACTED}
    assert transition.next_probability < transition.previous_probability
