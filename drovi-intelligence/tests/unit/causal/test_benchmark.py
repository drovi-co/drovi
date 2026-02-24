from src.causal import run_causal_backtest


def test_causal_backtest_beats_correlation_baseline() -> None:
    result = run_causal_backtest(
        max_k=5,
        min_improvement=0.03,
        min_causal_quality=0.72,
    )

    assert result["cases_total"] >= 3
    assert result["average_improvement"] >= 0.03
    assert result["average_causal_ndcg"] > result["average_correlation_ndcg"]
    assert result["passed"] is True


def test_causal_backtest_fails_strict_quality_gate() -> None:
    result = run_causal_backtest(
        max_k=5,
        min_improvement=0.20,
        min_causal_quality=0.95,
    )

    assert result["passed"] is False
