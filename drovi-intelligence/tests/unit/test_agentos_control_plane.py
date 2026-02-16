from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.agentos.control_plane.compiler import DeploymentSnapshotCompiler
from src.agentos.control_plane.models import (
    AgentMemoryScopeRecord,
    AgentPlaybookRecord,
    AgentProfileRecord,
    AgentRoleRecord,
    DeploymentRecord,
    OrganizationPolicyRecord,
    PermissionScopeRecord,
    TriggerRecord,
)
from src.agentos.control_plane.policy import PolicyCompiler
from src.agentos.control_plane.routing import TriggerRoutingService


class _FakeRegistry:
    async def resolve_deployment_bundle(self, *, organization_id: str, deployment_id: str):
        deployment = DeploymentRecord(
            id=deployment_id,
            organization_id=organization_id,
            role_id="agrole_sales",
            profile_id="agprof_sales",
            playbook_id="agplay_sales",
            version=4,
            status="active",
            rollout_strategy={"strategy": "canary", "percent": 10},
            snapshot_hash="placeholder",
            published_at=datetime(2026, 2, 13, tzinfo=timezone.utc),
            created_at=datetime(2026, 2, 13, tzinfo=timezone.utc),
            updated_at=datetime(2026, 2, 13, tzinfo=timezone.utc),
        )
        role = AgentRoleRecord(
            id="agrole_sales",
            organization_id=organization_id,
            role_key="sales.sdr",
            name="Sales SDR",
            status="active",
            metadata={"pack": "sales"},
        )
        profile = AgentProfileRecord(
            id="agprof_sales",
            organization_id=organization_id,
            role_id="agrole_sales",
            name="Sales Profile",
            autonomy_tier="L2",
            model_policy={"model": "gpt-5-mini"},
            tool_policy={"allow_tools": ["crm", "email"]},
            permission_scope=PermissionScopeRecord(
                tools=["crm", "email", "browser"],
                sources=["emails", "crm"],
                channels=["email", "slack"],
                allow_external_send=True,
                allowed_domains=["acme.com"],
            ),
            metadata={},
        )
        playbook = AgentPlaybookRecord(
            id="agplay_sales",
            organization_id=organization_id,
            role_id="agrole_sales",
            version=9,
            name="Outbound Playbook",
            objective="Generate qualified meetings with enterprise accounts.",
            constraints={"required_tools": ["crm", "email"], "required_read_scopes": ["pipeline"]},
            sop={
                "steps": [
                    {"id": "step_1", "action": "crm"},
                    {"id": "step_2", "action": "email"},
                ]
            },
            success_criteria={"meetings_booked": {"min": 3}},
            escalation_policy={"on_failure": True},
            dsl={},
            status="active",
        )
        memory = AgentMemoryScopeRecord(
            readable_scopes=["pipeline", "accounts"],
            writable_scopes=["pipeline"],
            retention_policy={"days": 365},
        )
        org_policy = OrganizationPolicyRecord(
            organization_id=organization_id,
            allowed_connectors=["crm", "email", "browser"],
            default_connection_visibility="org_shared",
            policy_overrides={"allow_external_send": True},
        )
        return deployment, role, profile, playbook, memory, org_policy

    async def list_enabled_triggers(self, *, organization_id: str, deployment_id: str | None = None):
        del deployment_id
        return [
            TriggerRecord(
                id="agtrg_event_specific",
                organization_id=organization_id,
                deployment_id="agdep_1",
                trigger_type="event",
                trigger_spec={"event_name": "ticket.created", "priority": 4},
                is_enabled=True,
                deployment_status="active",
            ),
            TriggerRecord(
                id="agtrg_event_generic",
                organization_id=organization_id,
                deployment_id="agdep_2",
                trigger_type="event",
                trigger_spec={"events": ["ticket.created", "ticket.updated"], "priority": 1},
                is_enabled=True,
                deployment_status="canary",
            ),
        ]


@pytest.mark.asyncio
async def test_snapshot_compiler_is_deterministic() -> None:
    compiler = DeploymentSnapshotCompiler(registry=_FakeRegistry())

    first = await compiler.compile_for_deployment(
        organization_id="org_demo",
        deployment_id="agdep_demo",
        force_refresh=True,
    )
    second = await compiler.compile_for_deployment(
        organization_id="org_demo",
        deployment_id="agdep_demo",
        force_refresh=True,
    )

    assert first.snapshot_hash == second.snapshot_hash
    assert first.compiled_policy.policy_hash == second.compiled_policy.policy_hash
    assert first.compiled_policy.allowed_tools == ["browser", "crm", "email"]


def test_policy_lint_detects_violations() -> None:
    compiler = PolicyCompiler()
    profile = AgentProfileRecord(
        id="agprof_bad",
        organization_id="org_demo",
        role_id="agrole_bad",
        name="Broken Profile",
        autonomy_tier="L3",
        tool_policy={"deny_tools": ["email"]},
        permission_scope=PermissionScopeRecord(
            tools=["email"],
            channels=["email"],
            sources=["emails"],
            allow_external_send=True,
        ),
        metadata={},
    )
    playbook = AgentPlaybookRecord(
        id="agplay_bad",
        organization_id="org_demo",
        role_id="agrole_bad",
        version=1,
        name="Broken Playbook",
        objective="Run unsupported tools with missing memory scope.",
        constraints={
            "required_tools": ["ghost_tool"],
            "required_read_scopes": ["matter.timeline"],
        },
        sop={"steps": [{"id": "s1", "action": "ghost_tool"}]},
        success_criteria={},
        escalation_policy={},
        dsl={},
        status="draft",
    )
    lint = compiler.lint_configuration(
        profile=profile,
        playbook=playbook,
        memory_scope=AgentMemoryScopeRecord(readable_scopes=[], writable_scopes=[], retention_policy={}),
        organization_policy=OrganizationPolicyRecord(organization_id="org_demo"),
    )

    assert lint.valid is False
    assert any("Unknown required tools" in error for error in lint.errors)
    assert any("Missing readable memory scopes" in error for error in lint.errors)


@pytest.mark.asyncio
async def test_trigger_routing_prefers_specific_higher_priority() -> None:
    service = TriggerRoutingService(registry=_FakeRegistry())

    decision = await service.simulate(
        organization_id="org_demo",
        trigger_type="event",
        event_name="ticket.created",
    )

    assert decision.selected is not None
    assert decision.selected.trigger_id == "agtrg_event_specific"
    assert len(decision.candidates) == 2
    assert decision.candidates[0].score > decision.candidates[1].score

