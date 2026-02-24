from src.causal import CausalEdge, CausalEngine, ObservedOutcome


def test_propagate_shock_traverses_multi_hop_edges() -> None:
    engine = CausalEngine()
    edges = [
        CausalEdge(
            edge_id="e1",
            source_ref="market_rate",
            target_ref="funding_cost",
            sign=1,
            strength=0.8,
            lag_hours=24,
            confidence=0.9,
        ),
        CausalEdge(
            edge_id="e2",
            source_ref="funding_cost",
            target_ref="runway",
            sign=-1,
            strength=0.7,
            lag_hours=48,
            confidence=0.85,
        ),
    ]

    impacts = engine.propagate_shock(
        edges=edges,
        origin_ref="market_rate",
        magnitude=1.0,
        max_hops=3,
    )

    assert impacts
    assert impacts[0].target_ref == "funding_cost"
    assert any(item.target_ref == "runway" for item in impacts)


def test_update_edge_adjusts_strength_confidence_and_lag_distribution() -> None:
    engine = CausalEngine()
    edge = CausalEdge(
        edge_id="edge_1",
        source_ref="source",
        target_ref="target",
        sign=1,
        strength=0.5,
        lag_hours=24,
        confidence=0.5,
    )

    updated = engine.update_edge(
        edge,
        observed_delta=0.8,
        expected_delta=0.6,
        observation_confidence=0.9,
        observed_lag_hours=30,
    )

    assert updated.strength >= 0.5
    assert updated.confidence > 0.5
    assert updated.lag_distribution is not None
    assert updated.lag_distribution["sample_size"] >= 2.0


def test_update_edges_from_outcomes_degrades_on_conflict() -> None:
    engine = CausalEngine()
    edge = CausalEdge(
        edge_id="edge_2",
        source_ref="a",
        target_ref="b",
        sign=1,
        strength=0.7,
        lag_hours=12,
        confidence=0.9,
    )

    updated = engine.update_edges_from_outcomes(
        edges=[edge],
        outcomes=[
            ObservedOutcome(
                source_ref="a",
                target_ref="b",
                observed_delta=-0.4,
                expected_delta=0.5,
                observation_confidence=0.8,
                observed_lag_hours=18,
                conflict_weight=0.7,
                evidence_ref="ev_1",
            )
        ],
    )

    assert len(updated) == 1
    assert updated[0].confidence < 0.9
    assert "ev_1" in updated[0].evidence_refs


def test_propagate_second_order_is_replay_stable() -> None:
    engine = CausalEngine()
    edges = [
        CausalEdge("e1", "origin", "mid", 1, 0.8, 6, 0.9),
        CausalEdge("e2", "mid", "leaf", 1, 0.75, 18, 0.85),
        CausalEdge("e3", "origin", "leaf", 1, 0.2, 4, 0.4),
    ]

    first = engine.propagate_second_order_impacts(
        edges=edges,
        origin_ref="origin",
        magnitude=1.0,
        max_hops=3,
    )
    second = engine.propagate_second_order_impacts(
        edges=edges,
        origin_ref="origin",
        magnitude=1.0,
        max_hops=3,
    )

    assert first
    assert any(item.target_ref == "leaf" for item in first)
    assert CausalEngine.replay_stability_hash(first) == CausalEngine.replay_stability_hash(second)
