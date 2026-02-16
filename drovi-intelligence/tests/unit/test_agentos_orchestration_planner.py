from __future__ import annotations

import pytest

from src.agentos.orchestration import (
    TeamBudgetPolicy,
    TeamBudgetViolation,
    TeamExecutionPolicy,
    TeamMemberSpec,
    build_team_plan,
    validate_team_budget,
)


@pytest.mark.unit
def test_build_team_plan_hybrid_respects_explicit_stage_and_stage_width() -> None:
    members = [
        TeamMemberSpec(role_id="role_a", priority=1, stage=2),
        TeamMemberSpec(role_id="role_b", priority=2),
        TeamMemberSpec(role_id="role_c", priority=3),
        TeamMemberSpec(role_id="role_d", priority=4),
    ]

    plan = build_team_plan(
        team_id="agteam_1",
        members=members,
        execution_policy=TeamExecutionPolicy(mode="hybrid", stage_width=2),
    )

    assert plan.team_id == "agteam_1"
    assert plan.mode == "hybrid"
    assert [stage.stage_index for stage in plan.stages] == [0, 1, 2]
    assert [member.role_id for member in plan.stages[0].members] == ["role_b"]
    assert [member.role_id for member in plan.stages[1].members] == ["role_c", "role_d"]
    assert [member.role_id for member in plan.stages[2].members] == ["role_a"]


@pytest.mark.unit
def test_validate_team_budget_rejects_parallel_limit() -> None:
    plan = build_team_plan(
        team_id="agteam_2",
        members=[
            TeamMemberSpec(role_id="role_a", priority=1),
            TeamMemberSpec(role_id="role_b", priority=2),
            TeamMemberSpec(role_id="role_c", priority=3),
        ],
        execution_policy=TeamExecutionPolicy(mode="parallel"),
    )

    with pytest.raises(TeamBudgetViolation) as exc:
        validate_team_budget(
            plan=plan,
            budget=TeamBudgetPolicy(max_sub_runs=10, max_parallel=2),
        )

    assert "max_parallel" in exc.value.message


@pytest.mark.unit
def test_validate_team_budget_rejects_estimated_token_cap() -> None:
    plan = build_team_plan(
        team_id="agteam_3",
        members=[
            TeamMemberSpec(role_id="role_a", priority=1),
            TeamMemberSpec(role_id="role_b", priority=2),
        ],
        execution_policy=TeamExecutionPolicy(mode="parallel"),
    )

    with pytest.raises(TeamBudgetViolation) as exc:
        validate_team_budget(
            plan=plan,
            budget=TeamBudgetPolicy(
                max_sub_runs=10,
                max_parallel=10,
                max_estimated_tokens=5000,
                estimated_tokens_per_member=3000,
            ),
        )

    assert "max_estimated_tokens" in exc.value.message


@pytest.mark.unit
def test_build_team_plan_handles_large_team_shapes() -> None:
    members = [
        TeamMemberSpec(role_id=f"role_{index:03d}", priority=index)
        for index in range(120)
    ]
    plan = build_team_plan(
        team_id="agteam_large",
        members=members,
        execution_policy=TeamExecutionPolicy(mode="hybrid", stage_width=8),
    )

    assert plan.total_sub_runs == 120
    assert plan.max_parallelism == 8
    assert len(plan.stages) == 15
