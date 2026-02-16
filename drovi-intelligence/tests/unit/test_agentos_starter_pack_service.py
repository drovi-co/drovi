from __future__ import annotations

from src.agentos.starter_packs.service import _metric_passed, _metric_value


def test_metric_value_reads_sample_with_default_zero() -> None:
    samples = {"run_success_rate": 0.93}
    assert _metric_value(metric_name="run_success_rate", samples=samples) == 0.93
    assert _metric_value(metric_name="missing_metric", samples=samples) == 0.0


def test_metric_passed_handles_gte_and_lte() -> None:
    assert _metric_passed(comparator="gte", metric_value=0.91, threshold=0.9) is True
    assert _metric_passed(comparator="gte", metric_value=0.89, threshold=0.9) is False
    assert _metric_passed(comparator="lte", metric_value=2, threshold=3) is True
    assert _metric_passed(comparator="lte", metric_value=4, threshold=3) is False
