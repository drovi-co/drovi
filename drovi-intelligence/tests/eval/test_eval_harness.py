import os
import pytest

from evaluation.evaluate import run_eval


@pytest.mark.skipif(os.getenv("EVAL_RUN") != "1", reason="Set EVAL_RUN=1 to enable eval")
def test_eval_harness():
    results = run_eval()
    assert results["samples"] > 0
    # Baseline thresholds (adjust as models improve)
    assert results["decisions"]["f1"] >= 0.3
    assert results["commitments"]["f1"] >= 0.3
