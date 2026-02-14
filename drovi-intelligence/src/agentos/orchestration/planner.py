from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .models import (
    PlannedTeamRun,
    PlannedTeamStage,
    TeamBudgetPolicy,
    TeamExecutionPolicy,
    TeamMemberSpec,
)


@dataclass(frozen=True)
class TeamBudgetViolation(Exception):
    message: str


def build_team_plan(
    *,
    team_id: str,
    members: Iterable[TeamMemberSpec],
    execution_policy: TeamExecutionPolicy,
) -> PlannedTeamRun:
    sorted_members = sorted(
        members,
        key=lambda member: (member.priority, member.role_id),
    )
    if not sorted_members:
        return PlannedTeamRun(team_id=team_id, mode=execution_policy.mode, stages=[])

    stages: dict[int, list[TeamMemberSpec]] = {}

    if execution_policy.mode == "parallel":
        stages[0] = list(sorted_members)
    elif execution_policy.mode == "sequential":
        for index, member in enumerate(sorted_members):
            stages[index] = [member]
    else:
        for index, member in enumerate(sorted_members):
            if member.stage is not None and member.stage >= 0:
                stage_index = member.stage
            else:
                stage_index = index // execution_policy.stage_width
            bucket = stages.setdefault(stage_index, [])
            bucket.append(member)

    ordered_stages = [
        PlannedTeamStage(stage_index=stage_index, members=stages[stage_index])
        for stage_index in sorted(stages.keys())
    ]

    return PlannedTeamRun(
        team_id=team_id,
        mode=execution_policy.mode,
        stages=ordered_stages,
        total_sub_runs=sum(len(stage.members) for stage in ordered_stages),
        max_parallelism=max(len(stage.members) for stage in ordered_stages),
    )


def validate_team_budget(
    *,
    plan: PlannedTeamRun,
    budget: TeamBudgetPolicy,
) -> None:
    if plan.total_sub_runs > budget.max_sub_runs:
        raise TeamBudgetViolation(
            f"Team plan exceeds max_sub_runs ({plan.total_sub_runs} > {budget.max_sub_runs})"
        )
    if plan.max_parallelism > budget.max_parallel:
        raise TeamBudgetViolation(
            f"Team plan exceeds max_parallel ({plan.max_parallelism} > {budget.max_parallel})"
        )

    if budget.max_estimated_tokens is not None:
        estimated_tokens = plan.total_sub_runs * budget.estimated_tokens_per_member
        if estimated_tokens > budget.max_estimated_tokens:
            raise TeamBudgetViolation(
                "Team plan exceeds max_estimated_tokens "
                f"({estimated_tokens} > {budget.max_estimated_tokens})"
            )
