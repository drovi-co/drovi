from src.world_model.benchmark import run_impact_benchmark


def test_impact_benchmark_passes_default_targets() -> None:
    result = run_impact_benchmark()

    assert result["cases_total"] >= 1
    assert result["passed"] is True


def test_impact_benchmark_fails_unrealistic_targets() -> None:
    result = run_impact_benchmark(
        min_precision_gain=0.95,
        max_alerts_per_event=0.2,
    )

    assert result["passed"] is False
