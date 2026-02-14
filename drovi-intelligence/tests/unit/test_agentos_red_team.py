from __future__ import annotations

import pytest

from src.agentos.control_plane.models import PolicyDecisionRecord
from src.agentos.control_plane.red_team import RedTeamPolicyHarness


class _FakePolicyEngine:
    async def decide(self, *, organization_id: str, deployment_id: str | None, tool_id: str, evidence_refs, metadata):
        del organization_id, deployment_id, tool_id, evidence_refs
        case_id = str(metadata.get("red_team_case") or "")
        if case_id == "unregistered_tool_denied":
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.tool_unregistered",
                reason="tool missing",
                reasons=["tool_manifest_missing"],
                tool_id="shadow.admin.delete",
                organization_id="org_test",
                deployment_id="agdep_1",
                action_tier="read_only",
            )
        if case_id == "kill_switch_blocks_side_effects":
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.kill_switch",
                reason="kill switch",
                reasons=["governance_kill_switch"],
                tool_id="email.send",
                organization_id="org_test",
                deployment_id="agdep_1",
                action_tier="external_commit",
            )
        if case_id == "retention_budget_enforced":
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.retention_violation",
                reason="retention",
                reasons=["governance_retention"],
                tool_id="storage.archive",
                organization_id="org_test",
                deployment_id="agdep_1",
                action_tier="low_risk_write",
            )
        return PolicyDecisionRecord(
            action="deny",
            code="agentos.policy.residency_violation",
            reason="residency",
            reasons=["governance_residency"],
            tool_id="files.upload",
            organization_id="org_test",
            deployment_id="agdep_1",
            action_tier="low_risk_write",
        )


class _FakeToolRegistry:
    async def upsert_manifest(self, *, organization_id: str, manifest: dict):
        del organization_id, manifest


class _FakeGovernanceService:
    def __init__(self) -> None:
        self._policy = {
            "organization_id": "org_test",
            "residency_region": "global",
            "allowed_regions": [],
            "data_retention_days": 365,
            "evidence_retention_days": 3650,
            "require_residency_enforcement": True,
            "enforce_delegated_authority": False,
            "kill_switch_enabled": False,
            "metadata": {},
        }

    async def get_policy(self, *, organization_id: str):
        del organization_id

        class _Policy:
            def __init__(self, payload: dict) -> None:
                self._payload = dict(payload)

            def model_dump(self, *, mode: str = "json") -> dict:
                del mode
                return dict(self._payload)

        return _Policy(self._policy)

    async def upsert_policy(self, *, organization_id: str, policy: dict, updated_by_user_id: str | None):
        del organization_id, updated_by_user_id
        self._policy.update(policy)


@pytest.mark.asyncio
async def test_red_team_harness_runs_default_cases_and_reports_pass() -> None:
    harness = RedTeamPolicyHarness(
        policy_engine=_FakePolicyEngine(),
        tool_registry=_FakeToolRegistry(),
        governance_service=_FakeGovernanceService(),
    )

    result = await harness.run(organization_id="org_test", deployment_id="agdep_1")

    assert result.passed is True
    assert result.total_count == 4
    assert result.failed_count == 0
