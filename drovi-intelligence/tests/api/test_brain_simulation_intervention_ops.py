from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeSimulationResponse:
    def model_dump(self, mode: str = "json") -> dict:
        return {
            "simulation_id": "sim_1",
            "scenario_name": "what_if",
            "baseline": {
                "open_commitments": 2,
                "overdue_commitments": 1,
                "at_risk_commitments": 2,
                "risk_score": 0.6,
                "risk_outlook": "medium",
            },
            "simulated": {
                "open_commitments": 1,
                "overdue_commitments": 0,
                "at_risk_commitments": 1,
                "risk_score": 0.3,
                "risk_outlook": "low",
            },
            "delta": {"risk_score": -0.3},
            "utility": {
                "profile_name": "balanced",
                "baseline_utility": 0.2,
                "simulated_utility": 0.5,
                "utility_delta": 0.3,
                "components": {},
            },
            "risk_intervals": [{"metric": "risk_score", "p10": 0.2, "p50": 0.3, "p90": 0.5}],
            "downside_risk_estimate": 0.2,
            "sensitivity": [],
            "stress_tests": [],
            "causal_projection": [],
            "causal_replay_hash": None,
            "scenario_replay_hash": "hash_1",
            "replay_seed": 1234,
            "narrative": "ok",
        }


class _FakeInterventionService:
    def __init__(self) -> None:
        self.propose_and_persist = AsyncMock(
            return_value={
                "intervention_id": "intv_1",
                "target_ref": "entity_1",
                "policy_class": "p1_human_approval",
                "status": "proposed",
                "action_graph": {"nodes": [{"step_id": "step_1"}], "edges": []},
            }
        )
        self.list_plans = AsyncMock(
            return_value=[
                {
                    "intervention_id": "intv_1",
                    "target_ref": "entity_1",
                    "policy_class": "p1_human_approval",
                    "status": "proposed",
                }
            ]
        )
        self.capture_outcome = AsyncMock(
            return_value={
                "realized_outcome_id": "out_1",
                "intervention_plan_id": "intv_1",
                "outcome_type": "execution_success",
                "outcome_hash": "hash_out",
            }
        )


async def test_brain_simulate_and_intervention_inline_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeInterventionService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(
        "src.api.routes.brain.run_simulation",
        AsyncMock(return_value=_FakeSimulationResponse()),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_intervention_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.record_audit_event", audit_mock)

    simulate_response = await async_client.post(
        "/api/v1/brain/simulate",
        json={
            "organization_id": "org_test",
            "scenario_name": "what_if",
            "horizon_days": 30,
            "persist": False,
            "publish_events": False,
            "enqueue": False,
        },
    )
    assert simulate_response.status_code == 200
    assert simulate_response.json()["enqueued"] is False
    assert simulate_response.json()["result"]["simulation_id"] == "sim_1"
    assert simulate_response.json()["explainability"]["output_type"] == "simulation"

    intervention_response = await async_client.post(
        "/api/v1/brain/interventions",
        json={
            "organization_id": "org_test",
            "target_ref": "entity_1",
            "pressure_score": 0.8,
            "causal_confidence": 0.6,
            "max_constraint_severity": "high",
            "enqueue": False,
        },
    )
    assert intervention_response.status_code == 200
    assert intervention_response.json()["result"]["intervention_id"] == "intv_1"
    assert intervention_response.json()["explainability"]["output_type"] == "intervention_proposal"

    list_response = await async_client.get("/api/v1/brain/interventions?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1

    outcome_response = await async_client.post(
        "/api/v1/brain/interventions/outcomes",
        json={
            "organization_id": "org_test",
            "intervention_plan_id": "intv_1",
            "outcome_type": "execution_success",
            "outcome_payload": {"risk_delta": -0.2},
            "enqueue": False,
        },
    )
    assert outcome_response.status_code == 200
    assert outcome_response.json()["result"]["realized_outcome_id"] == "out_1"
    assert outcome_response.json()["explainability"]["output_type"] == "intervention_outcome"
    assert audit_mock.await_count >= 3


async def test_brain_simulate_and_intervention_enqueue_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue_job_mock = AsyncMock(side_effect=["job_sim_1", "job_intv_1", "job_out_1"])
    monkeypatch.setattr("src.api.routes.brain.enqueue_job", enqueue_job_mock)

    simulate_response = await async_client.post(
        "/api/v1/brain/simulate",
        json={
            "organization_id": "org_test",
            "scenario_name": "what_if",
            "horizon_days": 30,
            "enqueue": True,
        },
    )
    assert simulate_response.status_code == 200
    assert simulate_response.json()["enqueued"] is True
    assert simulate_response.json()["job_id"] == "job_sim_1"

    intervention_response = await async_client.post(
        "/api/v1/brain/interventions",
        json={
            "organization_id": "org_test",
            "target_ref": "entity_1",
            "pressure_score": 0.8,
            "causal_confidence": 0.6,
            "enqueue": True,
        },
    )
    assert intervention_response.status_code == 200
    assert intervention_response.json()["enqueued"] is True
    assert intervention_response.json()["job_id"] == "job_intv_1"

    outcome_response = await async_client.post(
        "/api/v1/brain/interventions/outcomes",
        json={
            "organization_id": "org_test",
            "intervention_plan_id": "intv_1",
            "outcome_type": "execution_success",
            "enqueue": True,
        },
    )
    assert outcome_response.status_code == 200
    assert outcome_response.json()["enqueued"] is True
    assert outcome_response.json()["job_id"] == "job_out_1"
    assert enqueue_job_mock.await_count == 3
