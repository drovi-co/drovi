from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

pytestmark = [pytest.mark.unit]


def _load_perf_budget_module():
    current = Path(__file__).resolve()
    candidate_paths = [
        current.parents[4] / "scripts" / "perf_budget.py",
        current.parents[3] / "scripts" / "perf_budget.py",
    ]
    script_path = next((path for path in candidate_paths if path.exists()), None)
    if script_path is None:
        pytest.skip("scripts/perf_budget.py is not available in this test environment")
    spec = importlib.util.spec_from_file_location("perf_budget", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_evaluate_budgets_passes_within_thresholds() -> None:
    module = _load_perf_budget_module()
    results = {
        "endpoints": {
            "GET /health": {"p95_ms": 120, "error_count": 0},
            "GET /api/v1/auth/me": {"p95_ms": 320, "error_count": 0},
        }
    }
    budgets = {
        "default_p95_ms": 500,
        "max_error_count": 0,
        "endpoint_p95_ms": {"GET /health": 200},
    }

    violations = module._evaluate_budgets(results, budgets)
    assert violations == []


def test_evaluate_budgets_detects_latency_and_error_violations() -> None:
    module = _load_perf_budget_module()
    results = {
        "endpoints": {
            "GET /health": {"p95_ms": 350, "error_count": 0},
            "GET /api/v1/auth/me": {"p95_ms": 200, "error_count": 2},
        }
    }
    budgets = {
        "default_p95_ms": 300,
        "max_error_count": 0,
        "endpoint_p95_ms": {"GET /health": 250},
    }

    violations = module._evaluate_budgets(results, budgets)
    assert len(violations) == 2
    assert "GET /health: p95 350ms > budget 250ms" in violations
    assert "GET /api/v1/auth/me: errors 2 > budget 0" in violations
