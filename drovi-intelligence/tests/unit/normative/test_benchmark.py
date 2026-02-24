from src.normative import run_normative_benchmark


def test_normative_benchmark_passes_default_targets() -> None:
    result = run_normative_benchmark(
        target_recall=0.9,
        max_false_positive_rate=0.2,
    )

    assert result["cases_total"] >= 4
    assert result["recall"] >= 0.9
    assert result["false_positive_rate"] <= 0.2
    assert result["passed"] is True


def test_normative_benchmark_fails_strict_targets() -> None:
    result = run_normative_benchmark(
        target_recall=1.0,
        max_false_positive_rate=-0.01,
    )

    assert result["passed"] is False
