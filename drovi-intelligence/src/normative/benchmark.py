"""Synthetic benchmark for normative breach recall and pre-breach precision."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.normative.engine import NormativeConstraint, NormativeEngine


@dataclass(frozen=True)
class NormativeBenchmarkCase:
    case_id: str
    constraints: list[NormativeConstraint]
    facts: dict[str, Any]
    expected_breaches: set[str]
    expected_warnings: set[str]


def default_normative_benchmark_cases() -> list[NormativeBenchmarkCase]:
    return [
        NormativeBenchmarkCase(
            case_id="breach_overdue_commitments",
            constraints=[
                NormativeConstraint(
                    constraint_id="c_overdue_cap",
                    title="Overdue commitments cap",
                    machine_rule="fact:internal.overdue_commitments <= 2",
                    severity_on_breach="high",
                    source_class="policy",
                )
            ],
            facts={"internal": {"overdue_commitments": 5}},
            expected_breaches={"c_overdue_cap"},
            expected_warnings=set(),
        ),
        NormativeBenchmarkCase(
            case_id="warning_high_impact_edge_pressure",
            constraints=[
                NormativeConstraint(
                    constraint_id="c_impact_limit",
                    title="High impact edge limit",
                    machine_rule="fact:external.high_impact_edges <= 10",
                    severity_on_breach="medium",
                    source_class="legal",
                    pre_breach_threshold=0.8,
                )
            ],
            facts={"external": {"high_impact_edges": 9}},
            expected_breaches=set(),
            expected_warnings={"c_impact_limit"},
        ),
        NormativeBenchmarkCase(
            case_id="compliant_no_signal",
            constraints=[
                NormativeConstraint(
                    constraint_id="c_open_risks",
                    title="Open risks budget",
                    machine_rule="fact:internal.open_risks <= 4",
                    severity_on_breach="medium",
                    source_class="contract",
                )
            ],
            facts={"internal": {"open_risks": 2}},
            expected_breaches=set(),
            expected_warnings=set(),
        ),
        NormativeBenchmarkCase(
            case_id="breach_contains_required_marker",
            constraints=[
                NormativeConstraint(
                    constraint_id="c_clause_marker",
                    title="Clause marker required",
                    machine_rule="fact:subject.contract_clause contains force_majeure",
                    severity_on_breach="critical",
                    source_class="contract",
                )
            ],
            facts={"subject": {"contract_clause": "payment_terms_only"}},
            expected_breaches={"c_clause_marker"},
            expected_warnings=set(),
        ),
    ]


def run_normative_benchmark(
    *,
    engine: NormativeEngine | None = None,
    target_recall: float = 0.9,
    max_false_positive_rate: float = 0.2,
) -> dict[str, Any]:
    evaluator = engine or NormativeEngine()
    cases = default_normative_benchmark_cases()

    true_positive = 0
    false_positive = 0
    expected_positive = 0
    warning_true_positive = 0
    warning_false_positive = 0
    expected_warning = 0
    case_results: list[dict[str, Any]] = []

    for case in cases:
        outputs = evaluator.evaluate(constraints=case.constraints, facts=case.facts)
        predicted_breaches = {
            item.constraint_id for item in outputs if item.status == "open"
        }
        predicted_warnings = {
            item.constraint_id for item in outputs if item.status == "warning"
        }

        expected_positive += len(case.expected_breaches)
        expected_warning += len(case.expected_warnings)

        true_positive += len(predicted_breaches.intersection(case.expected_breaches))
        false_positive += len(predicted_breaches.difference(case.expected_breaches))
        warning_true_positive += len(predicted_warnings.intersection(case.expected_warnings))
        warning_false_positive += len(predicted_warnings.difference(case.expected_warnings))

        case_results.append(
            {
                "case_id": case.case_id,
                "expected_breaches": sorted(case.expected_breaches),
                "expected_warnings": sorted(case.expected_warnings),
                "predicted_breaches": sorted(predicted_breaches),
                "predicted_warnings": sorted(predicted_warnings),
            }
        )

    recall = true_positive / max(1, expected_positive)
    warning_recall = warning_true_positive / max(1, expected_warning)
    all_predictions = true_positive + false_positive + warning_true_positive + warning_false_positive
    false_positive_rate = (false_positive + warning_false_positive) / max(1, all_predictions)
    passed = recall >= target_recall and false_positive_rate <= max_false_positive_rate

    return {
        "benchmark": "normative-sentinel-v1",
        "cases_total": len(cases),
        "recall": round(recall, 4),
        "warning_recall": round(warning_recall, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "target_recall": round(target_recall, 4),
        "max_false_positive_rate": round(max_false_positive_rate, 4),
        "passed": passed,
        "cases": case_results,
    }
