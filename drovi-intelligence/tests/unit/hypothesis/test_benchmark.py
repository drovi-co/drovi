from src.hypothesis.benchmark import run_hypothesis_red_team_benchmark


def test_hypothesis_benchmark_passes_default_gate() -> None:
    result = run_hypothesis_red_team_benchmark(top_k=3, pass_threshold=0.78)

    assert result["cases_total"] >= 5
    assert result["top1_accuracy"] >= 0.8
    assert result["alternative_coverage_at_k"] == 1.0
    assert result["passed"] is True


def test_hypothesis_benchmark_fails_strict_gate() -> None:
    result = run_hypothesis_red_team_benchmark(top_k=3, pass_threshold=0.99)

    assert result["benchmark_score"] < 0.99
    assert result["passed"] is False
