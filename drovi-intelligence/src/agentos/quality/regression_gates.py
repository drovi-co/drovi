from __future__ import annotations

from datetime import timedelta
from statistics import mean
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import (
    RegressionGateCreateRequest,
    RegressionGateEvaluation,
    RegressionGateEvaluationResponse,
    RegressionGateRecord,
)


class RegressionGateService:
    """Defines and evaluates automated quality regression gates."""

    async def create_gate(
        self,
        *,
        organization_id: str,
        request: RegressionGateCreateRequest,
        created_by_user_id: str | None,
    ) -> RegressionGateRecord:
        gate_id = new_prefixed_id("aggate")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_quality_regression_gate (
                        id,
                        organization_id,
                        role_id,
                        deployment_id,
                        metric_name,
                        comparator,
                        threshold,
                        lookback_days,
                        min_samples,
                        severity,
                        is_enabled,
                        metadata,
                        created_by_user_id,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id,
                        :organization_id,
                        :role_id,
                        :deployment_id,
                        :metric_name,
                        :comparator,
                        :threshold,
                        :lookback_days,
                        :min_samples,
                        :severity,
                        :is_enabled,
                        CAST(:metadata AS JSONB),
                        :created_by_user_id,
                        :created_at,
                        :updated_at
                    )
                    """
                ),
                {
                    "id": gate_id,
                    "organization_id": organization_id,
                    "role_id": request.role_id,
                    "deployment_id": request.deployment_id,
                    "metric_name": request.metric_name,
                    "comparator": request.comparator,
                    "threshold": request.threshold,
                    "lookback_days": request.lookback_days,
                    "min_samples": request.min_samples,
                    "severity": request.severity,
                    "is_enabled": request.is_enabled,
                    "metadata": json_dumps_canonical(request.metadata),
                    "created_by_user_id": created_by_user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            row_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, deployment_id, metric_name, comparator, threshold,
                           lookback_days, min_samples, severity, is_enabled, metadata, created_by_user_id,
                           created_at, updated_at
                    FROM agent_quality_regression_gate
                    WHERE id = :id
                    """
                ),
                {"id": gate_id},
            )
            row = row_result.fetchone()
            await session.commit()
        if row is None:
            raise RuntimeError("Failed to create regression gate")
        return RegressionGateRecord.model_validate(_row_dict(row, json_fields={"metadata"}))

    async def list_gates(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        deployment_id: str | None = None,
        only_enabled: bool = False,
        limit: int = 200,
        offset: int = 0,
    ) -> list[RegressionGateRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, deployment_id, metric_name, comparator, threshold,
                           lookback_days, min_samples, severity, is_enabled, metadata, created_by_user_id,
                           created_at, updated_at
                    FROM agent_quality_regression_gate
                    WHERE organization_id = :organization_id
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                      AND (:only_enabled = false OR is_enabled = true)
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "role_id": role_id,
                    "deployment_id": deployment_id,
                    "only_enabled": only_enabled,
                    "limit": limit,
                    "offset": offset,
                },
            )
            rows = result.fetchall()
        return [RegressionGateRecord.model_validate(_row_dict(row, json_fields={"metadata"})) for row in rows]

    async def evaluate(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        deployment_id: str | None = None,
        only_enabled: bool = True,
        persist_events: bool = True,
    ) -> RegressionGateEvaluationResponse:
        gates = await self.list_gates(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            only_enabled=only_enabled,
            limit=500,
            offset=0,
        )
        now = utc_now()
        evaluations: list[RegressionGateEvaluation] = []
        for gate in gates:
            current_value, current_count = await self._metric_value(
                organization_id=organization_id,
                gate=gate,
                current_window=True,
            )
            baseline_value, baseline_count = await self._metric_value(
                organization_id=organization_id,
                gate=gate,
                current_window=False,
            )

            sample_count = min(current_count, baseline_count) if gate.comparator in {"max_drop", "min_improvement"} else current_count
            if sample_count < gate.min_samples:
                evaluation = RegressionGateEvaluation(
                    gate_id=gate.id,
                    metric_name=gate.metric_name,
                    comparator=gate.comparator,
                    threshold=gate.threshold,
                    baseline_value=baseline_value,
                    current_value=current_value,
                    delta_value=None if baseline_value is None or current_value is None else current_value - baseline_value,
                    sample_count=sample_count,
                    verdict="insufficient_data",
                    blocked=False,
                    severity=gate.severity,
                    metadata={"required_samples": gate.min_samples},
                )
            else:
                evaluation = _evaluate_gate(gate=gate, baseline_value=baseline_value, current_value=current_value, sample_count=sample_count)
            evaluations.append(evaluation)

        if persist_events and evaluations:
            await self._persist_events(
                organization_id=organization_id,
                evaluations=evaluations,
            )

        blocked = any(item.blocked for item in evaluations)
        return RegressionGateEvaluationResponse(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            evaluated_at=now,
            blocked=blocked,
            evaluations=evaluations,
        )

    async def _metric_value(
        self,
        *,
        organization_id: str,
        gate: RegressionGateRecord,
        current_window: bool,
    ) -> tuple[float | None, int]:
        lookback = timedelta(days=gate.lookback_days)
        now = utc_now()
        if current_window:
            start_time = now - lookback
            end_time = now
        else:
            start_time = now - (lookback * 2)
            end_time = now - lookback

        if gate.metric_name in {"quality_score", "confidence_score"}:
            return await self._score_metric(
                organization_id=organization_id,
                gate=gate,
                metric_name=gate.metric_name,
                start_time=start_time,
                end_time=end_time,
            )
        if gate.metric_name == "eval_pass_rate":
            return await self._eval_pass_rate(
                organization_id=organization_id,
                gate=gate,
                start_time=start_time,
                end_time=end_time,
            )
        if gate.metric_name in {"feedback_acceptance_rate", "feedback_rejection_rate"}:
            return await self._feedback_rate(
                organization_id=organization_id,
                gate=gate,
                metric_name=gate.metric_name,
                start_time=start_time,
                end_time=end_time,
            )
        return None, 0

    async def _score_metric(
        self,
        *,
        organization_id: str,
        gate: RegressionGateRecord,
        metric_name: str,
        start_time: Any,
        end_time: Any,
    ) -> tuple[float | None, int]:
        column = "quality_score" if metric_name == "quality_score" else "confidence_score"
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT AVG({column}) AS metric_value, COUNT(*) AS sample_count
                    FROM agent_run_quality_score
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND evaluated_at < :end_time
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "start_time": start_time,
                    "end_time": end_time,
                    "role_id": gate.role_id,
                    "deployment_id": gate.deployment_id,
                },
            )
            row = result.fetchone()
        if row is None:
            return None, 0
        metric_value = float(row.metric_value) if row.metric_value is not None else None
        sample_count = int(row.sample_count or 0)
        return metric_value, sample_count

    async def _eval_pass_rate(
        self,
        *,
        organization_id: str,
        gate: RegressionGateRecord,
        start_time: Any,
        end_time: Any,
    ) -> tuple[float | None, int]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE passed = true) AS passed_count
                    FROM agent_eval_result
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND evaluated_at < :end_time
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "start_time": start_time,
                    "end_time": end_time,
                    "deployment_id": gate.deployment_id,
                },
            )
            row = result.fetchone()
        if row is None:
            return None, 0
        total = int(row.total_count or 0)
        passed = int(row.passed_count or 0)
        if total == 0:
            return None, 0
        return passed / total, total

    async def _feedback_rate(
        self,
        *,
        organization_id: str,
        gate: RegressionGateRecord,
        metric_name: str,
        start_time: Any,
        end_time: Any,
    ) -> tuple[float | None, int]:
        verdict = "accepted" if metric_name == "feedback_acceptance_rate" else "rejected"
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE verdict = :target_verdict) AS target_count
                    FROM agent_feedback
                    WHERE organization_id = :organization_id
                      AND created_at >= :start_time
                      AND created_at < :end_time
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "start_time": start_time,
                    "end_time": end_time,
                    "deployment_id": gate.deployment_id,
                    "target_verdict": verdict,
                },
            )
            row = result.fetchone()
        if row is None:
            return None, 0
        total = int(row.total_count or 0)
        target = int(row.target_count or 0)
        if total == 0:
            return None, 0
        return target / total, total

    async def _persist_events(
        self,
        *,
        organization_id: str,
        evaluations: list[RegressionGateEvaluation],
    ) -> None:
        now = utc_now()
        async with get_db_session() as session:
            for evaluation in evaluations:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_quality_regression_event (
                            organization_id,
                            gate_id,
                            metric_name,
                            baseline_value,
                            current_value,
                            delta_value,
                            sample_count,
                            verdict,
                            blocked,
                            metadata,
                            created_at
                        ) VALUES (
                            :organization_id,
                            :gate_id,
                            :metric_name,
                            :baseline_value,
                            :current_value,
                            :delta_value,
                            :sample_count,
                            :verdict,
                            :blocked,
                            CAST(:metadata AS JSONB),
                            :created_at
                        )
                        """
                    ),
                    {
                        "organization_id": organization_id,
                        "gate_id": evaluation.gate_id,
                        "metric_name": evaluation.metric_name,
                        "baseline_value": evaluation.baseline_value,
                        "current_value": evaluation.current_value,
                        "delta_value": evaluation.delta_value,
                        "sample_count": evaluation.sample_count,
                        "verdict": evaluation.verdict,
                        "blocked": evaluation.blocked,
                        "metadata": json_dumps_canonical(evaluation.metadata),
                        "created_at": now,
                    },
                )
            await session.commit()


def _evaluate_gate(
    *,
    gate: RegressionGateRecord,
    baseline_value: float | None,
    current_value: float | None,
    sample_count: int,
) -> RegressionGateEvaluation:
    delta_value = None if baseline_value is None or current_value is None else current_value - baseline_value

    if current_value is None:
        return RegressionGateEvaluation(
            gate_id=gate.id,
            metric_name=gate.metric_name,
            comparator=gate.comparator,
            threshold=gate.threshold,
            baseline_value=baseline_value,
            current_value=current_value,
            delta_value=delta_value,
            sample_count=sample_count,
            verdict="insufficient_data",
            blocked=False,
            severity=gate.severity,
            metadata={"reason": "No current metric value"},
        )

    triggered = False
    if gate.comparator == "min_value":
        triggered = current_value < gate.threshold
    elif gate.comparator == "max_value":
        triggered = current_value > gate.threshold
    elif gate.comparator == "max_drop":
        if baseline_value is not None:
            triggered = (baseline_value - current_value) > gate.threshold
    elif gate.comparator == "min_improvement":
        if baseline_value is not None:
            triggered = (current_value - baseline_value) < gate.threshold

    blocked = bool(triggered and gate.severity == "blocker")
    if triggered and blocked:
        verdict = "block"
    elif triggered:
        verdict = "warn"
    else:
        verdict = "pass"

    return RegressionGateEvaluation(
        gate_id=gate.id,
        metric_name=gate.metric_name,
        comparator=gate.comparator,
        threshold=gate.threshold,
        baseline_value=baseline_value,
        current_value=current_value,
        delta_value=delta_value,
        sample_count=sample_count,
        verdict=verdict,  # type: ignore[arg-type]
        blocked=blocked,
        severity=gate.severity,
        metadata={"triggered": triggered},
    )


def _row_dict(row: Any, *, json_fields: set[str] | None = None) -> dict[str, Any]:
    payload = dict(row._mapping if hasattr(row, "_mapping") else row)
    if not json_fields:
        return payload
    for field in json_fields:
        raw = payload.get(field)
        if isinstance(raw, str):
            try:
                import json

                payload[field] = json.loads(raw)
            except Exception:
                pass
    return payload

