import os
import pytest

from evaluation.evaluate import run_eval


@pytest.mark.skipif(os.getenv("EVAL_RUN") != "1", reason="Set EVAL_RUN=1 to enable eval")
def test_eval_harness():
    results = run_eval()
    assert results["samples"] >= 500

    min_f1 = float(os.getenv("EVAL_MIN_F1", "0.4"))
    min_f1_tasks = float(os.getenv("EVAL_MIN_F1_TASKS", "0.3"))
    min_f1_risks = float(os.getenv("EVAL_MIN_F1_RISKS", "0.3"))
    min_f1_claims = float(os.getenv("EVAL_MIN_F1_CLAIMS", "0.3"))
    max_hallucination = float(os.getenv("EVAL_MAX_HALLUCINATION", "0.5"))

    # Baseline thresholds (adjust as models improve)
    assert results["decisions"]["f1"] >= min_f1
    assert results["commitments"]["f1"] >= min_f1
    assert results["tasks"]["f1"] >= min_f1_tasks
    assert results["risks"]["f1"] >= min_f1_risks
    assert results["claims"]["f1"] >= min_f1_claims

    assert results["decisions"]["hallucination_rate"] <= max_hallucination
    assert results["commitments"]["hallucination_rate"] <= max_hallucination
    assert results["tasks"]["hallucination_rate"] <= max_hallucination
    assert results["risks"]["hallucination_rate"] <= max_hallucination
    assert results["claims"]["hallucination_rate"] <= max_hallucination
