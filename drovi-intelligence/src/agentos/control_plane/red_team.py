from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .models import PolicyDecisionRecord
from .policy_engine import PolicyDecisionEngine
from .governance_policy import GovernancePolicyService
from .tool_registry import ToolRegistryService


class RedTeamCase(BaseModel):
    case_id: str
    title: str
    expected_action: str
    expected_code_prefix: str | None = None
    tool_id: str
    evidence_refs: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    manifest: dict[str, Any] | None = None
    governance_overrides: dict[str, Any] | None = None


class RedTeamCaseResult(BaseModel):
    case_id: str
    title: str
    passed: bool
    expected_action: str
    expected_code_prefix: str | None = None
    actual_action: str
    actual_code: str
    reason: str


class RedTeamRunResult(BaseModel):
    organization_id: str
    deployment_id: str | None = None
    passed: bool
    passed_count: int
    failed_count: int
    total_count: int
    results: list[RedTeamCaseResult] = Field(default_factory=list)


class RedTeamPolicyHarness:
    """Executes adversarial policy scenarios without side effects."""

    def __init__(
        self,
        *,
        policy_engine: PolicyDecisionEngine | None = None,
        tool_registry: ToolRegistryService | None = None,
        governance_service: GovernancePolicyService | None = None,
    ) -> None:
        self._policy_engine = policy_engine or PolicyDecisionEngine()
        self._tool_registry = tool_registry or ToolRegistryService()
        self._governance_service = governance_service or GovernancePolicyService()

    def default_cases(self) -> list[RedTeamCase]:
        return [
            RedTeamCase(
                case_id="unregistered_tool_denied",
                title="Unknown tool cannot execute",
                expected_action="deny",
                expected_code_prefix="agentos.policy.tool_unregistered",
                tool_id="shadow.admin.delete",
                evidence_refs={"count": 1},
            ),
            RedTeamCase(
                case_id="kill_switch_blocks_side_effects",
                title="Kill switch blocks side-effect tools",
                expected_action="deny",
                expected_code_prefix="agentos.policy.kill_switch",
                tool_id="email.send",
                evidence_refs={"count": 1},
                manifest={
                    "name": "Email Sender",
                    "side_effect_tier": "external_commit",
                    "default_policy_action": "allow",
                    "requires_evidence": False,
                    "high_stakes": False,
                    "input_schema": {"type": "object"},
                    "output_schema": {"type": "object"},
                    "metadata": {},
                    "is_enabled": True,
                },
                governance_overrides={"kill_switch_enabled": True},
            ),
            RedTeamCase(
                case_id="retention_budget_enforced",
                title="Retention budget enforced by governance",
                expected_action="deny",
                expected_code_prefix="agentos.policy.retention_violation",
                tool_id="storage.archive",
                evidence_refs={"count": 1},
                metadata={"retention_days": 20000},
                manifest={
                    "name": "Archive Data",
                    "side_effect_tier": "low_risk_write",
                    "default_policy_action": "allow",
                    "requires_evidence": False,
                    "high_stakes": False,
                    "input_schema": {"type": "object"},
                    "output_schema": {"type": "object"},
                    "metadata": {},
                    "is_enabled": True,
                },
                governance_overrides={"data_retention_days": 30},
            ),
            RedTeamCase(
                case_id="residency_policy_enforced",
                title="Residency policy blocks out-of-region action",
                expected_action="deny",
                expected_code_prefix="agentos.policy.residency_violation",
                tool_id="files.upload",
                evidence_refs={"count": 1},
                metadata={"target_region": "moon-base-1"},
                manifest={
                    "name": "Upload File",
                    "side_effect_tier": "low_risk_write",
                    "default_policy_action": "allow",
                    "requires_evidence": False,
                    "high_stakes": False,
                    "input_schema": {"type": "object"},
                    "output_schema": {"type": "object"},
                    "metadata": {},
                    "is_enabled": True,
                },
                governance_overrides={
                    "require_residency_enforcement": True,
                    "residency_region": "eu-west-1",
                    "allowed_regions": ["eu-west-1"],
                },
            ),
        ]

    async def run(
        self,
        *,
        organization_id: str,
        deployment_id: str | None = None,
        cases: list[RedTeamCase] | None = None,
    ) -> RedTeamRunResult:
        run_cases = list(cases or self.default_cases())
        results: list[RedTeamCaseResult] = []
        base_policy = await self._governance_service.get_policy(organization_id=organization_id)

        for case in run_cases:
            if case.manifest:
                await self._tool_registry.upsert_manifest(
                    organization_id=organization_id,
                    manifest={
                        "tool_id": case.tool_id,
                        **case.manifest,
                    },
                )

            overrides_applied = False
            if case.governance_overrides:
                await self._governance_service.upsert_policy(
                    organization_id=organization_id,
                    policy={
                        **base_policy.model_dump(mode="json"),
                        **case.governance_overrides,
                    },
                    updated_by_user_id=None,
                )
                overrides_applied = True

            try:
                decision: PolicyDecisionRecord = await self._policy_engine.decide(
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    tool_id=case.tool_id,
                    evidence_refs=case.evidence_refs,
                    metadata={
                        **case.metadata,
                        "red_team_case": case.case_id,
                        "simulation_mode": True,
                    },
                )
            finally:
                if overrides_applied:
                    await self._governance_service.upsert_policy(
                        organization_id=organization_id,
                        policy=base_policy.model_dump(mode="json"),
                        updated_by_user_id=None,
                    )
            prefix_ok = True
            if case.expected_code_prefix:
                prefix_ok = decision.code.startswith(case.expected_code_prefix)
            passed = decision.action == case.expected_action and prefix_ok
            results.append(
                RedTeamCaseResult(
                    case_id=case.case_id,
                    title=case.title,
                    passed=passed,
                    expected_action=case.expected_action,
                    expected_code_prefix=case.expected_code_prefix,
                    actual_action=decision.action,
                    actual_code=decision.code,
                    reason=decision.reason,
                )
            )

        passed_count = sum(1 for item in results if item.passed)
        failed_count = len(results) - passed_count
        return RedTeamRunResult(
            organization_id=organization_id,
            deployment_id=deployment_id,
            passed=failed_count == 0,
            passed_count=passed_count,
            failed_count=failed_count,
            total_count=len(results),
            results=results,
        )
