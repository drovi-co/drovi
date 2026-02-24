from src.mlops import (
    GraphBackendBenchmark,
    GraphImpactBaseline,
    TemporalForecastBaseline,
    VerifierNLIBaseline,
    benchmark_causal_discovery,
)


def test_temporal_forecast_baseline_predicts_horizon() -> None:
    model = TemporalForecastBaseline(mode="state_space")
    model.fit([10.0, 11.0, 12.0, 13.0])
    preds = model.predict(horizon=3)
    assert len(preds) == 3
    assert preds[0] < preds[-1]


def test_graph_impact_baseline_scores_candidate_links() -> None:
    baseline = GraphImpactBaseline()
    scores = baseline.score_links(
        edges=[("a", "b"), ("b", "c"), ("a", "d"), ("d", "c")],
        candidate_pairs=[("a", "c"), ("b", "d")],
    )
    assert set(scores.keys()) == {"a->c", "b->d"}
    assert all(0.0 <= value <= 1.0 for value in scores.values())


def test_verifier_nli_baseline_outputs_support_and_contradiction_scores() -> None:
    scores = VerifierNLIBaseline().score(
        claim="The client is compliant with policy",
        evidence="The client is not compliant with policy",
    )
    assert scores["contradiction"] > scores["consistency"]


def test_causal_discovery_benchmark_compares_to_heuristics() -> None:
    result = benchmark_causal_discovery(
        discovered_edges={("a", "b"), ("b", "c")},
        heuristic_edges={("a", "b")},
        truth_edges={("a", "b"), ("b", "c"), ("c", "d")},
    )
    assert "f1_improvement" in result
    assert result["discovery"]["recall"] >= result["heuristic"]["recall"]


def test_graph_backend_benchmark_produces_migration_playbook() -> None:
    benchmark = GraphBackendBenchmark()
    current = benchmark.run_hot_path_benchmark(
        query_latencies_ms={"neighbors": [140, 150, 160]},
        query_qps={"neighbors": 700},
    )
    candidate = benchmark.run_hot_path_benchmark(
        query_latencies_ms={"neighbors": [80, 90, 95]},
        query_qps={"neighbors": 900},
    )
    decision = benchmark.evaluate_secondary_backend(
        current_metrics={**current, "semantic_mismatch_rate": 0.02},
        candidate_metrics={**candidate, "semantic_mismatch_rate": 0.005},
    )
    playbook = benchmark.migration_playbook()

    assert "passed" in decision
    assert playbook["name"] == "graph-backend-migration-v1"
    assert len(playbook["steps"]) >= 4

