from __future__ import annotations

from typing import Any

from src.continuum.dsl import ContinuumDefinition


def convert_continuum_to_playbook(payload: dict[str, Any]) -> dict[str, Any]:
    """Read-only adapter from legacy Continuum DSL to Agent Playbook shape."""

    definition = ContinuumDefinition.model_validate(payload)

    sop_steps = []
    for step in definition.steps:
        sop_steps.append(
            {
                "id": step.id,
                "name": step.name,
                "action": step.action,
                "inputs": step.inputs,
                "requires": step.requires,
                "policy_context": step.policy_context,
                "proof": step.proof.model_dump(mode="json") if step.proof else None,
            }
        )

    constraints = {
        "legacy_constraints": [constraint.model_dump(mode="json") for constraint in definition.constraints],
        "forbidden_tools": [],
        "schedule_type": definition.schedule.type,
    }

    success_criteria = {
        "proofs": [proof.model_dump(mode="json") for proof in definition.proofs],
        "goal": definition.goal,
    }

    playbook = {
        "name": definition.name,
        "objective": definition.goal,
        "constraints": constraints,
        "sop": {"steps": sop_steps},
        "success_criteria": success_criteria,
        "escalation_policy": definition.escalation.model_dump(mode="json"),
        "dsl": {
            "legacy_source": "continuum",
            "continuum": definition.model_dump(mode="json"),
        },
    }

    trigger_hint: dict[str, Any]
    if definition.schedule.type == "cron":
        trigger_hint = {"trigger_type": "schedule", "trigger_spec": {"cron": definition.schedule.cron}}
    elif definition.schedule.type == "interval":
        trigger_hint = {
            "trigger_type": "schedule",
            "trigger_spec": {"interval_minutes": definition.schedule.interval_minutes or 60},
        }
    else:
        trigger_hint = {"trigger_type": "manual", "trigger_spec": {"on_demand": True}}

    return {
        "playbook": playbook,
        "trigger_hint": trigger_hint,
        "warnings": [
            "This conversion is read-only and does not persist any data.",
            "Review constraints.forbidden_tools and policy contexts before publishing.",
        ],
    }

