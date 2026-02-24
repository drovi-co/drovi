"""Hypothesis generation, scoring, and quality benchmarking."""

from src.hypothesis.benchmark import (
    HypothesisBenchmarkCase,
    default_hypothesis_benchmark_cases,
    run_hypothesis_red_team_benchmark,
)
from src.hypothesis.engine import HypothesisCandidate, HypothesisEngine
from src.hypothesis.service import HypothesisService, get_hypothesis_service

__all__ = [
    "HypothesisBenchmarkCase",
    "HypothesisCandidate",
    "HypothesisEngine",
    "HypothesisService",
    "default_hypothesis_benchmark_cases",
    "get_hypothesis_service",
    "run_hypothesis_red_team_benchmark",
]
