"""Persistence and event hooks for intervention planning."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.events.publisher import get_event_publisher
from src.intervention.engine import InterventionEngine


def _stable_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


class InterventionService:
    """Generates, persists, and publishes intervention + outcome artifacts."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._engine = InterventionEngine()

    async def propose_and_persist(
        self,
        *,
        target_ref: str,
        pressure_score: float,
        causal_confidence: float,
        max_constraint_severity: str | None,
        recommended_actions: list[str] | None = None,
        simulation_id: str | None = None,
        persist: bool = True,
        publish_events: bool = True,
    ) -> dict[str, Any]:
        candidate = self._engine.propose(
            target_ref=target_ref,
            pressure_score=pressure_score,
            causal_confidence=causal_confidence,
            max_constraint_severity=max_constraint_severity,
            recommended_actions=recommended_actions,
        )
        payload = candidate.to_dict()
        now = datetime.now(UTC)
        intervention_hash = _stable_hash(
            {
                "organization_id": self.organization_id,
                "target_ref": target_ref,
                "policy_class": payload.get("policy_class"),
                "action_graph": payload.get("action_graph"),
                "rollback_steps": payload.get("rollback_steps"),
                "simulation_id": simulation_id,
            }
        )

        if persist:
            await self._persist_intervention_plan(
                payload=payload,
                now=now,
                intervention_hash=intervention_hash,
                simulation_id=simulation_id,
            )

        if publish_events:
            await self._publish_proposed_event(
                payload=payload,
                now=now,
                simulation_id=simulation_id,
            )

        return {
            **payload,
            "organization_id": self.organization_id,
            "status": "proposed",
            "intervention_hash": intervention_hash,
            "proposed_at": now.isoformat(),
            "simulation_id": simulation_id,
        }

    async def list_plans(
        self,
        *,
        status: str | None = None,
        policy_class: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses = ["organization_id = :organization_id"]
        params: dict[str, Any] = {
            "organization_id": self.organization_id,
            "limit": max(1, min(int(limit), 500)),
            "offset": max(0, int(offset)),
        }
        if status:
            clauses.append("status = :status")
            params["status"] = str(status).strip().lower()
        if policy_class:
            clauses.append("policy_class = :policy_class")
            params["policy_class"] = str(policy_class).strip().lower()

        where_clause = " AND ".join(clauses)
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT id, target_ref, policy_class, status, action_graph, rollback_plan,
                                   expected_utility_delta, downside_risk_estimate, intervention_hash,
                                   proposed_at, approved_at, executed_at, rolled_back_at, created_at, updated_at
                            FROM intervention_plan
                            WHERE {where_clause}
                            ORDER BY created_at DESC
                            LIMIT :limit OFFSET :offset
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        plans: list[dict[str, Any]] = []
        for row in rows:
            plans.append(
                {
                    "intervention_id": row.id,
                    "target_ref": row.target_ref,
                    "policy_class": row.policy_class,
                    "status": row.status,
                    "action_graph": row.action_graph or {},
                    "rollback_plan": row.rollback_plan or {},
                    "expected_utility_delta": row.expected_utility_delta,
                    "downside_risk_estimate": row.downside_risk_estimate,
                    "intervention_hash": row.intervention_hash,
                    "proposed_at": row.proposed_at.isoformat() if row.proposed_at else None,
                    "approved_at": row.approved_at.isoformat() if row.approved_at else None,
                    "executed_at": row.executed_at.isoformat() if row.executed_at else None,
                    "rolled_back_at": row.rolled_back_at.isoformat() if row.rolled_back_at else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
            )
        return plans

    async def capture_outcome(
        self,
        *,
        outcome_type: str,
        outcome_payload: dict[str, Any] | None = None,
        intervention_plan_id: str | None = None,
        measured_at: datetime | None = None,
        persist: bool = True,
        publish_events: bool = True,
    ) -> dict[str, Any]:
        measured = measured_at or datetime.now(UTC)
        outcome_id = f"out_{uuid4().hex[:16]}"
        payload = dict(outcome_payload or {})
        outcome_hash = _stable_hash(
            {
                "organization_id": self.organization_id,
                "intervention_plan_id": intervention_plan_id,
                "outcome_type": outcome_type,
                "outcome_payload": payload,
                "measured_at": measured.isoformat(),
            }
        )

        result = {
            "realized_outcome_id": outcome_id,
            "intervention_plan_id": intervention_plan_id,
            "outcome_type": outcome_type,
            "outcome_payload": payload,
            "outcome_hash": outcome_hash,
            "measured_at": measured.isoformat(),
        }

        if persist:
            await self._persist_outcome(
                result=result,
                measured=measured,
            )

        if publish_events:
            await self._publish_outcome_event(
                result=result,
                measured=measured,
            )

        return result

    async def _persist_intervention_plan(
        self,
        *,
        payload: dict[str, Any],
        now: datetime,
        intervention_hash: str,
        simulation_id: str | None,
    ) -> None:
        action_graph = payload.get("action_graph") or {}
        rollback_plan = {
            "steps": list(payload.get("rollback_steps") or []),
            "verification": dict(payload.get("rollback_verification") or {}),
        }
        metadata = {
            "simulation_id": simulation_id,
            "policy_gates": list(payload.get("policy_gates") or []),
            "feedback_hooks": dict(payload.get("feedback_hooks") or {}),
        }
        if isinstance(action_graph, dict):
            action_graph = {**action_graph, "metadata": metadata}

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO intervention_plan (
                            id,
                            organization_id,
                            target_ref,
                            policy_class,
                            status,
                            action_graph,
                            rollback_plan,
                            expected_utility_delta,
                            downside_risk_estimate,
                            intervention_hash,
                            proposed_at,
                            created_at,
                            updated_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :target_ref,
                            :policy_class,
                            :status,
                            :action_graph,
                            :rollback_plan,
                            :expected_utility_delta,
                            :downside_risk_estimate,
                            :intervention_hash,
                            :proposed_at,
                            :created_at,
                            :updated_at
                        )
                        """
                    ),
                    {
                        "id": payload["intervention_id"],
                        "organization_id": self.organization_id,
                        "target_ref": payload["target_ref"],
                        "policy_class": payload["policy_class"],
                        "status": "proposed",
                        "action_graph": action_graph,
                        "rollback_plan": rollback_plan,
                        "expected_utility_delta": payload.get("expected_utility_delta"),
                        "downside_risk_estimate": payload.get("downside_risk_estimate"),
                        "intervention_hash": intervention_hash,
                        "proposed_at": now,
                        "created_at": now,
                        "updated_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

    async def _persist_outcome(
        self,
        *,
        result: dict[str, Any],
        measured: datetime,
    ) -> None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO realized_outcome (
                            id,
                            organization_id,
                            intervention_plan_id,
                            outcome_type,
                            outcome_payload,
                            outcome_hash,
                            measured_at,
                            created_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :intervention_plan_id,
                            :outcome_type,
                            :outcome_payload,
                            :outcome_hash,
                            :measured_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": result["realized_outcome_id"],
                        "organization_id": self.organization_id,
                        "intervention_plan_id": result["intervention_plan_id"],
                        "outcome_type": result["outcome_type"],
                        "outcome_payload": result["outcome_payload"],
                        "outcome_hash": result["outcome_hash"],
                        "measured_at": measured,
                        "created_at": measured,
                    },
                )
                if result["intervention_plan_id"]:
                    status = "completed"
                    rolled_back_at = None
                    executed_at = measured
                    outcome_type = str(result["outcome_type"] or "").lower()
                    if "rollback" in outcome_type:
                        status = "rolled_back"
                        rolled_back_at = measured
                    elif "fail" in outcome_type:
                        status = "failed"
                    elif "execute" in outcome_type:
                        status = "executed"

                    await session.execute(
                        text(
                            """
                            UPDATE intervention_plan
                            SET status = :status,
                                executed_at = :executed_at,
                                rolled_back_at = :rolled_back_at,
                                updated_at = :updated_at
                            WHERE id = :id
                              AND organization_id = :organization_id
                            """
                        ),
                        {
                            "status": status,
                            "executed_at": executed_at,
                            "rolled_back_at": rolled_back_at,
                            "updated_at": measured,
                            "id": result["intervention_plan_id"],
                            "organization_id": self.organization_id,
                        },
                    )
        finally:
            set_rls_context(None, is_internal=False)

    async def _publish_proposed_event(
        self,
        *,
        payload: dict[str, Any],
        now: datetime,
        simulation_id: str | None,
    ) -> None:
        publisher = await get_event_publisher()
        action_graph = dict(payload.get("action_graph") or {})
        if simulation_id:
            action_graph["simulation_id"] = simulation_id
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": now,
                "producer": "drovi-intelligence",
                "event_type": "intervention.proposed.v1",
                "payload": {
                    "intervention_plan_id": payload["intervention_id"],
                    "target_ref": payload["target_ref"],
                    "policy_class": payload["policy_class"],
                    "status": "proposed",
                    "proposed_at": now,
                    "expected_utility_delta": payload.get("expected_utility_delta"),
                    "downside_risk_estimate": payload.get("downside_risk_estimate"),
                    "action_graph": action_graph,
                    "rollback_plan": {
                        "steps": list(payload.get("rollback_steps") or []),
                        "verification": dict(payload.get("rollback_verification") or {}),
                    },
                },
            }
        )

    async def _publish_outcome_event(
        self,
        *,
        result: dict[str, Any],
        measured: datetime,
    ) -> None:
        publisher = await get_event_publisher()
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": measured,
                "producer": "drovi-intelligence",
                "event_type": "outcome.realized.v1",
                "payload": {
                    "realized_outcome_id": result["realized_outcome_id"],
                    "intervention_plan_id": result.get("intervention_plan_id"),
                    "outcome_type": result["outcome_type"],
                    "measured_at": measured,
                    "outcome_payload": result.get("outcome_payload") or {},
                    "outcome_hash": result.get("outcome_hash"),
                },
            }
        )


_services: dict[str, InterventionService] = {}


async def get_intervention_service(organization_id: str) -> InterventionService:
    if organization_id not in _services:
        _services[organization_id] = InterventionService(organization_id=organization_id)
    return _services[organization_id]
