from src.hypothesis import HypothesisEngine


def test_generate_alternatives_is_deterministic_and_ranked() -> None:
    engine = HypothesisEngine()

    first = engine.generate_alternatives(
        belief_id="belief_1",
        proposition="Semiconductor supply constraints increase delivery risk",
        observations=["Taiwan shipping delays", "Export control tightening"],
        base_probability=0.55,
        max_candidates=3,
    )
    second = engine.generate_alternatives(
        belief_id="belief_1",
        proposition="Semiconductor supply constraints increase delivery risk",
        observations=["Taiwan shipping delays", "Export control tightening"],
        base_probability=0.55,
        max_candidates=3,
    )

    assert [item.hypothesis_id for item in first] == [item.hypothesis_id for item in second]
    assert len(first) == 3
    assert first[0].score() >= first[-1].score()


def test_reject_low_quality_splits_candidates() -> None:
    engine = HypothesisEngine()
    candidates = engine.generate_alternatives(
        belief_id="belief_2",
        proposition="Revenue decline driven by pricing pressure",
        observations=[],
        base_probability=0.35,
        max_candidates=4,
    )

    accepted, rejected = engine.reject_low_quality(candidates, min_score=0.55)

    assert accepted
    assert rejected
    assert all(item.score() >= 0.55 for item in accepted)
    assert all(item.score() < 0.55 for item in rejected)
