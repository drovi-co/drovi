from __future__ import annotations

from dataclasses import dataclass
from statistics import quantiles
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import OfflineEvalCase, OfflineEvalMetricResult, OfflineEvalRunResult


@dataclass(frozen=True)
class OfflineEvalThresholds:
    accuracy: float = 0.8
    evidence_coverage: float = 0.7
    policy_compliance: float = 0.95
    latency_p95_ms: float = 3000.0


class OfflineEvaluationRunner:
    """Runs deterministic offline benchmark suites for AgentOS deployments."""

    def __init__(self, *, thresholds: OfflineEvalThresholds | None = None) -> None:
        self._thresholds = thresholds or OfflineEvalThresholds()

    async def run_suite(
        self,
        *,
        organization_id: str,
        suite_name: str,
        cases: list[OfflineEvalCase],
        deployment_id: str | None = None,
        persist_results: bool = True,
        metadata: dict[str, Any] | None = None,
    ) -> OfflineEvalRunResult:
        if not cases:
            raise ValueError("Offline evaluation suite requires at least one case")

        total_cases = len(cases)
        correct_cases = 0
        evidence_supported_cases = 0
        policy_compliant_cases = 0
        latencies: list[float] = []

        for case in cases:
            if self._case_matches(case.expected, case.observed):
                correct_cases += 1
            if case.evidence_refs:
                evidence_supported_cases += 1
            if (case.policy_decision or "allow").lower() in {"allow", "approved"}:
                policy_compliant_cases += 1
            if case.latency_ms is not None:
                latencies.append(case.latency_ms)

        accuracy = correct_cases / total_cases
        evidence_coverage = evidence_supported_cases / total_cases
        policy_compliance = policy_compliant_cases / total_cases
        latency_p95_ms = _p95(latencies) if latencies else 0.0

        metrics = [
            OfflineEvalMetricResult(
                metric_name="offline.accuracy",
                metric_value=accuracy,
                threshold=self._thresholds.accuracy,
                comparator="gte",
                passed=accuracy >= self._thresholds.accuracy,
                description="Share of benchmark cases where observed output matched expected output.",
            ),
            OfflineEvalMetricResult(
                metric_name="offline.evidence_coverage",
                metric_value=evidence_coverage,
                threshold=self._thresholds.evidence_coverage,
                comparator="gte",
                passed=evidence_coverage >= self._thresholds.evidence_coverage,
                description="Share of benchmark cases with evidence references attached.",
            ),
            OfflineEvalMetricResult(
                metric_name="offline.policy_compliance",
                metric_value=policy_compliance,
                threshold=self._thresholds.policy_compliance,
                comparator="gte",
                passed=policy_compliance >= self._thresholds.policy_compliance,
                description="Share of benchmark cases that stayed within policy-compliant decisions.",
            ),
            OfflineEvalMetricResult(
                metric_name="offline.latency_p95_ms",
                metric_value=latency_p95_ms,
                threshold=self._thresholds.latency_p95_ms,
                comparator="lte",
                passed=latency_p95_ms <= self._thresholds.latency_p95_ms,
                description="p95 latency in milliseconds across benchmark cases.",
            ),
        ]

        run_metadata = {
            "source": "offline_eval_runner",
            "case_count": total_cases,
            "thresholds": self._thresholds.__dict__,
        }
        if metadata:
            run_metadata.update(metadata)

        result = OfflineEvalRunResult(
            organization_id=organization_id,
            deployment_id=deployment_id,
            suite_name=suite_name,
            passed=all(metric.passed for metric in metrics),
            case_count=total_cases,
            metrics=metrics,
            metadata=run_metadata,
        )

        if persist_results:
            await self._persist_eval_result(
                organization_id=organization_id,
                deployment_id=deployment_id,
                suite_name=suite_name,
                metrics=metrics,
                metadata=run_metadata,
            )

        return result

    async def _persist_eval_result(
        self,
        *,
        organization_id: str,
        deployment_id: str | None,
        suite_name: str,
        metrics: list[OfflineEvalMetricResult],
        metadata: dict[str, Any],
    ) -> None:
        now = utc_now()
        async with get_db_session() as session:
            for metric in metrics:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_eval_result (
                            id,
                            organization_id,
                            deployment_id,
                            run_id,
                            suite_name,
                            metric_name,
                            metric_value,
                            threshold,
                            passed,
                            metadata,
                            evaluated_at,
                            created_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :deployment_id,
                            NULL,
                            :suite_name,
                            :metric_name,
                            :metric_value,
                            :threshold,
                            :passed,
                            CAST(:metadata AS JSONB),
                            :evaluated_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": new_prefixed_id("ageval"),
                        "organization_id": organization_id,
                        "deployment_id": deployment_id,
                        "suite_name": suite_name,
                        "metric_name": metric.metric_name,
                        "metric_value": metric.metric_value,
                        "threshold": metric.threshold,
                        "passed": metric.passed,
                        "metadata": json_dumps_canonical(
                            {
                                **metadata,
                                "comparator": metric.comparator,
                                "description": metric.description,
                            }
                        ),
                        "evaluated_at": now,
                        "created_at": now,
                    },
                )
            await session.commit()

    @staticmethod
    def _case_matches(expected: dict[str, Any], observed: dict[str, Any]) -> bool:
        if not expected:
            return bool(observed)
        for key, expected_value in expected.items():
            observed_value = observed.get(key)
            if isinstance(expected_value, dict):
                if not isinstance(observed_value, dict):
                    return False
                if not OfflineEvaluationRunner._case_matches(expected_value, observed_value):
                    return False
                continue
            if isinstance(expected_value, list):
                if not isinstance(observed_value, list):
                    return False
                if set(str(item) for item in expected_value) - set(str(item) for item in observed_value):
                    return False
                continue
            if observed_value != expected_value:
                return False
        return True


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    try:
        # inclusive method keeps stable behavior for small samples
        return quantiles(values, n=100, method="inclusive")[94]
    except Exception:
        return max(values)

