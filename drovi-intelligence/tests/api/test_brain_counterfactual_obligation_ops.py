from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeSimulationResult:
    def __init__(self, simulation_id: str, risk_score: float, utility_score: float, downside: float) -> None:
        self.simulation_id = simulation_id
        self.simulated = SimpleNamespace(risk_score=risk_score)
        self.utility = SimpleNamespace(simulated_utility=utility_score, utility_delta=utility_score - 0.2)
        self.downside_risk_estimate = downside

    def model_dump(self, mode: str = "json") -> dict:
        return {
            "simulation_id": self.simulation_id,
            "simulated": {"risk_score": self.simulated.risk_score},
            "utility": {
                "simulated_utility": self.utility.simulated_utility,
                "utility_delta": self.utility.utility_delta,
            },
            "downside_risk_estimate": self.downside_risk_estimate,
        }


class _FakeInterventionService:
    def __init__(self) -> None:
        self.propose_and_persist = AsyncMock(
            side_effect=[
                {"intervention_id": "intv_a", "policy_class": "p2_guardrailed"},
                {"intervention_id": "intv_b", "policy_class": "p1_human_approval"},
            ]
        )


class _FakeNormativeService:
    def __init__(self) -> None:
        self.list_constraints = AsyncMock(
            return_value=[
                {"id": "constraint_1", "title": "Tax filing deadline", "is_active": True},
                {"id": "constraint_2", "title": "Disclosure policy", "is_active": True},
            ]
        )
        self.list_violations = AsyncMock(
            return_value=[
                {"id": "viol_1", "status": "warning", "severity": "medium", "constraint_title": "Tax filing deadline"},
                {"id": "viol_2", "status": "open", "severity": "high", "constraint_title": "Disclosure policy"},
            ]
        )


async def test_counterfactual_lab_compare_endpoint(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_simulation_mock = AsyncMock(
        side_effect=[
            _FakeSimulationResult("sim_a", risk_score=0.42, utility_score=0.61, downside=0.09),
            _FakeSimulationResult("sim_b", risk_score=0.58, utility_score=0.44, downside=0.17),
        ]
    )
    monkeypatch.setattr("src.api.routes.brain.run_simulation", run_simulation_mock)
    monkeypatch.setattr(
        "src.api.routes.brain.get_intervention_service",
        AsyncMock(return_value=_FakeInterventionService()),
    )

    response = await async_client.post(
        "/api/v1/brain/counterfactual-lab/compare",
        json={
            "organization_id": "org_test",
            "scenario_a": {"organization_id": "org_test", "scenario_name": "a", "horizon_days": 30},
            "scenario_b": {"organization_id": "org_test", "scenario_name": "b", "horizon_days": 30},
            "target_ref": "portfolio_risk",
            "generate_interventions": True,
        },
    )
    assert response.status_code == 200
    payload = response.json()["comparison"]
    assert payload["preferred"] == "a"
    assert payload["intervention_previews"]["a"]["intervention_id"] == "intv_a"
    assert payload["intervention_previews"]["b"]["intervention_id"] == "intv_b"
    assert run_simulation_mock.await_count == 2


async def test_obligation_sentinel_dashboard_and_triage_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    normative_service = _FakeNormativeService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_normative_intelligence_service",
        AsyncMock(return_value=normative_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.run_simulation",
        AsyncMock(return_value=_FakeSimulationResult("sim_triage", risk_score=0.5, utility_score=0.5, downside=0.12)),
    )

    dashboard = await async_client.get("/api/v1/brain/obligation-sentinel/dashboard?organization_id=org_test")
    assert dashboard.status_code == 200
    summary = dashboard.json()["dashboard"]["summary"]
    assert summary["active_constraints"] == 2
    assert summary["pre_breach_warnings"] == 1
    assert summary["post_breach_open"] == 1

    triage = await async_client.post(
        "/api/v1/brain/obligation-sentinel/triage",
        json={
            "organization_id": "org_test",
            "violation_id": "viol_2",
            "action": "simulate_impact",
            "notes": "needs board review",
            "include_counterfactual_preview": True,
        },
    )
    assert triage.status_code == 200
    triage_payload = triage.json()["triage"]
    assert triage_payload["violation_id"] == "viol_2"
    assert triage_payload["action"] == "simulate_impact"
    assert triage_payload["counterfactual_preview"]["simulation_id"] == "sim_triage"
