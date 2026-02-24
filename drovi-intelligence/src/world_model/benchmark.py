"""Synthetic benchmark for exposure/impact precision and alert density."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.world_model.impact import ImpactEngineV2


@dataclass(slots=True)
class ImpactBenchmarkCase:
    case_id: str
    internal_objects: list[dict[str, Any]]
    external_events: list[dict[str, Any]]
    expected_internal_refs: set[str]
    risk_overlay: dict[str, Any]
    causal_strength_by_ref: dict[str, float]


def default_impact_benchmark_cases() -> list[ImpactBenchmarkCase]:
    return [
        ImpactBenchmarkCase(
            case_id="legal_rule_changes_contract_exposure",
            internal_objects=[
                {
                    "id": "obj_contract_renewal",
                    "type": "commitment",
                    "entity_refs": ["acme"],
                    "counterparty_refs": ["acme_vendor"],
                    "materiality": 0.9,
                },
                {
                    "id": "obj_marketing_plan",
                    "type": "task",
                    "entity_refs": ["globex"],
                    "materiality": 0.4,
                },
            ],
            external_events=[
                {
                    "event_id": "ev_reg_1",
                    "domain": "legal",
                    "entity_refs": ["acme_vendor"],
                    "reliability": 0.92,
                    "materiality": 0.88,
                }
            ],
            expected_internal_refs={"obj_contract_renewal"},
            risk_overlay={"default_multiplier": 1.0},
            causal_strength_by_ref={"obj_contract_renewal": 0.78},
        ),
        ImpactBenchmarkCase(
            case_id="macro_shock_hits_supply_chain",
            internal_objects=[
                {
                    "id": "obj_supply_risk",
                    "type": "risk",
                    "entity_refs": ["supply_chain"],
                    "dependency_refs": ["chip_foundry"],
                    "materiality": 0.85,
                },
                {
                    "id": "obj_sales_q3",
                    "type": "commitment",
                    "entity_refs": ["retail_segment"],
                    "materiality": 0.45,
                },
            ],
            external_events=[
                {
                    "event_id": "ev_macro_1",
                    "domain": "macro",
                    "entity_refs": ["chip_foundry"],
                    "reliability": 0.83,
                    "materiality": 0.8,
                }
            ],
            expected_internal_refs={"obj_supply_risk"},
            risk_overlay={"default_multiplier": 1.0},
            causal_strength_by_ref={"obj_supply_risk": 0.8},
        ),
        ImpactBenchmarkCase(
            case_id="research_signal_should_not_spam_unrelated_objects",
            internal_objects=[
                {
                    "id": "obj_medical_ai_thesis",
                    "type": "brief",
                    "entity_refs": ["med_ai"],
                    "dependency_refs": ["fda_guidance"],
                    "materiality": 0.75,
                },
                {
                    "id": "obj_generic_admin",
                    "type": "task",
                    "entity_refs": ["internal_ops"],
                    "materiality": 0.2,
                },
                {
                    "id": "obj_generic_ops_2",
                    "type": "task",
                    "entity_refs": ["internal_ops"],
                    "materiality": 0.2,
                },
            ],
            external_events=[
                {
                    "event_id": "ev_research_1",
                    "domain": "research",
                    "entity_refs": ["fda_guidance"],
                    "reliability": 0.88,
                    "materiality": 0.72,
                }
            ],
            expected_internal_refs={"obj_medical_ai_thesis"},
            risk_overlay={"default_multiplier": 1.0},
            causal_strength_by_ref={"obj_medical_ai_thesis": 0.72},
        ),
    ]


def run_impact_benchmark(
    *,
    min_precision_gain: float = 0.2,
    max_alerts_per_event: float = 2.0,
) -> dict[str, Any]:
    engine = ImpactEngineV2()
    cases = default_impact_benchmark_cases()

    total_tp = 0
    total_fp = 0
    total_fn = 0
    baseline_tp = 0
    baseline_fp = 0
    total_alerts = 0
    total_events = 0

    case_results: list[dict[str, Any]] = []

    for case in cases:
        predicted = engine.compute_bridges(
            internal_objects=case.internal_objects,
            external_events=case.external_events,
            risk_overlay=case.risk_overlay,
            causal_strength_by_ref=case.causal_strength_by_ref,
            min_score=0.35,
            max_per_internal=2,
            max_total=8,
        )
        predicted_refs = {item.internal_object_ref for item in predicted}
        expected = set(case.expected_internal_refs)

        tp = len(predicted_refs & expected)
        fp = len(predicted_refs - expected)
        fn = len(expected - predicted_refs)
        total_tp += tp
        total_fp += fp
        total_fn += fn

        baseline_predicted = {
            str(item.get("id"))
            for item in case.internal_objects
            if str(item.get("id"))
        }
        baseline_tp += len(baseline_predicted & expected)
        baseline_fp += len(baseline_predicted - expected)

        total_alerts += len(predicted)
        total_events += max(1, len(case.external_events))

        case_results.append(
            {
                "case_id": case.case_id,
                "predicted_count": len(predicted_refs),
                "expected_count": len(expected),
                "tp": tp,
                "fp": fp,
                "fn": fn,
            }
        )

    precision = (total_tp / (total_tp + total_fp)) if (total_tp + total_fp) else 0.0
    recall = (total_tp / (total_tp + total_fn)) if (total_tp + total_fn) else 0.0
    baseline_precision = (
        baseline_tp / (baseline_tp + baseline_fp)
        if (baseline_tp + baseline_fp)
        else 0.0
    )
    precision_gain = precision - baseline_precision
    alerts_per_event = total_alerts / max(total_events, 1)

    passed = precision_gain >= min_precision_gain and alerts_per_event <= max_alerts_per_event

    return {
        "benchmark": "impact-v2-precision-density-v1",
        "cases_total": len(cases),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "baseline_precision": round(baseline_precision, 4),
        "precision_gain": round(precision_gain, 4),
        "alerts_per_event": round(alerts_per_event, 4),
        "targets": {
            "min_precision_gain": min_precision_gain,
            "max_alerts_per_event": max_alerts_per_event,
        },
        "passed": passed,
        "cases": case_results,
    }
