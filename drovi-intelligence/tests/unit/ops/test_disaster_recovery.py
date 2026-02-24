from __future__ import annotations

import pytest

from src.ops.disaster_recovery import DrillTarget, MultiRegionDrillPlanner

pytestmark = [pytest.mark.unit]


def _targets() -> list[DrillTarget]:
    return [
        DrillTarget(
            layer="evidence_store",
            primary_region="us-east-1",
            secondary_region="us-west-2",
            rto_target_minutes=30,
            rpo_target_minutes=10,
        ),
        DrillTarget(
            layer="lakehouse",
            primary_region="us-east-1",
            secondary_region="us-west-2",
            rto_target_minutes=45,
            rpo_target_minutes=15,
        ),
    ]


def test_drill_plan_contains_snapshot_restore_integrity_steps() -> None:
    planner = MultiRegionDrillPlanner()
    plan = planner.build_plan(organization_id="org_1", targets=_targets(), initiated_by="sre")

    assert plan["organization_id"] == "org_1"
    assert len(plan["targets"]) == 2
    assert len(plan["checklist"]) == 8
    assert any(item["step"] == "restore_secondary" for item in plan["checklist"])


def test_drill_evaluation_flags_failures() -> None:
    planner = MultiRegionDrillPlanner()
    evaluation = planner.evaluate_results(
        targets=_targets(),
        results=[
            {
                "layer": "evidence_store",
                "observed_rto_minutes": 20,
                "observed_rpo_minutes": 5,
                "integrity_ok": True,
                "checksum_match_ratio": 1.0,
            },
            {
                "layer": "lakehouse",
                "observed_rto_minutes": 90,
                "observed_rpo_minutes": 20,
                "integrity_ok": True,
                "checksum_match_ratio": 0.998,
            },
        ],
    )

    assert evaluation["passed"] is False
    failed_layers = [item["layer"] for item in evaluation["reports"] if not item["passed"]]
    assert failed_layers == ["lakehouse"]
