from __future__ import annotations

import pytest

from src.agentos.control_plane.continuum_migration import ContinuumMigrationService


@pytest.mark.unit
def test_calculate_equivalence_for_interval_definition_is_high_confidence() -> None:
    service = ContinuumMigrationService()
    score, report, adapted = service.calculate_equivalence(
        continuum_definition_payload={
            "name": "Pilot Follow-up",
            "goal": "Track pilot follow-ups and notify owners.",
            "schedule": {"type": "interval", "interval_minutes": 60},
            "steps": [
                {"id": "scan", "name": "Scan tasks", "action": "workflow:intelligence_brief", "inputs": {}},
                {"id": "notify", "name": "Notify owner", "action": "workflow:risk_analysis", "inputs": {}},
            ],
            "proofs": [{"type": "quote", "criteria": "Must include source quote"}],
            "constraints": [
                {
                    "type": "no_external_send",
                    "expression": "outbound.send == false",
                    "config": {"enabled": True},
                }
            ],
            "escalation": {"on_failure": True, "notify_on_failure": True},
        }
    )

    assert score >= 0.95
    assert report["score_breakdown"]["schedule"] >= 0.95
    assert report["counts"]["original_steps"] == 2
    assert report["counts"]["adapted_steps"] == 2
    assert adapted["trigger_hint"]["trigger_type"] == "schedule"
    assert adapted["trigger_hint"]["trigger_spec"]["interval_minutes"] == 60


@pytest.mark.unit
def test_calculate_equivalence_for_on_demand_definition_uses_manual_trigger() -> None:
    service = ContinuumMigrationService()
    score, report, adapted = service.calculate_equivalence(
        continuum_definition_payload={
            "name": "Manual Escalation",
            "goal": "Run only when manually requested.",
            "schedule": {"type": "on_demand"},
            "steps": [
                {"id": "brief", "name": "Build brief", "action": "workflow:intelligence_brief", "inputs": {}},
            ],
            "proofs": [],
            "constraints": [],
            "escalation": {"on_failure": False},
        }
    )

    assert score >= 0.9
    assert report["schedule"]["original_type"] == "on_demand"
    assert adapted["trigger_hint"]["trigger_type"] == "manual"
