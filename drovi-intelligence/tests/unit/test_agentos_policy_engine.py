from __future__ import annotations

import pytest

from src.agentos.control_plane.models import (
    CompiledPolicy,
    DelegatedAuthorityEvaluation,
    GovernancePolicyRecord,
    PolicyOverlayRecord,
    ToolManifestRecord,
)
from src.agentos.control_plane.policy_engine import PolicyDecisionEngine
from src.kernel.errors import NotFoundError


class _FakeToolRegistry:
    def __init__(self, manifests: dict[str, ToolManifestRecord]) -> None:
        self._manifests = manifests

    async def get_manifest(self, *, organization_id: str, tool_id: str) -> ToolManifestRecord:
        key = f"{organization_id}:{tool_id}"
        manifest = self._manifests.get(key)
        if manifest is None:
            raise NotFoundError(
                code="agentos.tools.not_found",
                message="not found",
                meta={"tool_id": tool_id},
            )
        return manifest


class _FakeOverlayService:
    def __init__(self, overlay: PolicyOverlayRecord) -> None:
        self._overlay = overlay

    async def get_overlay(self, *, organization_id: str) -> PolicyOverlayRecord:
        assert organization_id == self._overlay.organization_id
        return self._overlay


class _FakeSnapshotCompiler:
    def __init__(self, compiled_policy: CompiledPolicy) -> None:
        self._compiled_policy = compiled_policy

    async def compile_for_deployment(self, *, organization_id: str, deployment_id: str, force_refresh: bool = False):
        del organization_id, deployment_id, force_refresh

        class _Snapshot:
            def __init__(self, compiled_policy: CompiledPolicy) -> None:
                self.compiled_policy = compiled_policy

        return _Snapshot(self._compiled_policy)


class _FakeGovernanceService:
    def __init__(self, policy: GovernancePolicyRecord) -> None:
        self._policy = policy

    async def get_policy(self, *, organization_id: str) -> GovernancePolicyRecord:
        assert organization_id == self._policy.organization_id
        return self._policy


class _MutableGovernanceService:
    def __init__(self, policy: GovernancePolicyRecord) -> None:
        self.policy = policy

    async def get_policy(self, *, organization_id: str) -> GovernancePolicyRecord:
        assert organization_id == self.policy.organization_id
        return self.policy


class _FakeDelegatedAuthorityService:
    def __init__(self, evaluation: DelegatedAuthorityEvaluation) -> None:
        self._evaluation = evaluation

    async def evaluate(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        tool_id: str,
        action_tier: str,
    ) -> DelegatedAuthorityEvaluation:
        del organization_id, deployment_id, tool_id, action_tier
        return self._evaluation


def _compiled_policy() -> CompiledPolicy:
    return CompiledPolicy(
        autonomy_tier="L2",
        allowed_tools=["email.send", "crm.update"],
        denied_tools=["filesystem.write"],
        allowed_sources=["email"],
        allowed_channels=["slack"],
        allow_external_send=False,
        allowed_domains=["acme.com"],
        organization_policy={},
        policy_hash="policy_hash",
    )


def _manifest(tool_id: str, **overrides) -> ToolManifestRecord:
    payload = {
        "id": f"agtool_{tool_id.replace('.', '_')}",
        "organization_id": "org_demo",
        "tool_id": tool_id,
        "name": tool_id,
        "description": None,
        "side_effect_tier": "low_risk_write",
        "default_policy_action": "allow",
        "requires_evidence": False,
        "high_stakes": False,
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "metadata": {},
        "is_enabled": True,
    }
    payload.update(overrides)
    return ToolManifestRecord.model_validate(payload)


def _governance_policy(**overrides) -> GovernancePolicyRecord:
    payload = {
        "organization_id": "org_demo",
        "residency_region": "global",
        "allowed_regions": [],
        "data_retention_days": 365,
        "evidence_retention_days": 3650,
        "require_residency_enforcement": True,
        "enforce_delegated_authority": False,
        "kill_switch_enabled": False,
        "metadata": {},
    }
    payload.update(overrides)
    return GovernancePolicyRecord.model_validate(payload)


@pytest.mark.asyncio
async def test_policy_engine_emergency_deny_overrides_deployment_allow() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:email.send": _manifest("email.send")}),
        overlay_service=_FakeOverlayService(
            PolicyOverlayRecord(
                organization_id="org_demo",
                emergency_denylist=["email.send"],
            )
        ),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy()),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="email.send",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.emergency_denylist"


@pytest.mark.asyncio
async def test_policy_engine_require_approval_from_org_overlay() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:crm.update": _manifest("crm.update")}),
        overlay_service=_FakeOverlayService(
            PolicyOverlayRecord(
                organization_id="org_demo",
                require_approval_tools=["crm.update"],
            )
        ),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy()),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={"count": 1},
    )

    assert decision.action == "require_approval"
    assert decision.code == "agentos.policy.requires_approval"


@pytest.mark.asyncio
async def test_policy_engine_blocks_high_stakes_without_evidence() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry(
            {
                "org_demo:crm.update": _manifest(
                    "crm.update",
                    high_stakes=True,
                    requires_evidence=True,
                    side_effect_tier="high_risk_write",
                )
            }
        ),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy()),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.no_evidence_no_action"


@pytest.mark.asyncio
async def test_policy_engine_blocks_unregistered_tool_alternate_path() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({}),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy()),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="browser.undocumented",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.tool_unregistered"


@pytest.mark.asyncio
async def test_policy_engine_kill_switch_blocks_side_effects() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:crm.update": _manifest("crm.update")}),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy(kill_switch_enabled=True)),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.kill_switch"


@pytest.mark.asyncio
async def test_policy_engine_blocks_residency_violation() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:crm.update": _manifest("crm.update")}),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(
            _governance_policy(residency_region="eu-west-1", allowed_regions=["eu-west-1"])
        ),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={"count": 1},
        metadata={"target_region": "us-east-1"},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.residency_violation"


@pytest.mark.asyncio
async def test_policy_engine_blocks_retention_violation() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:crm.update": _manifest("crm.update")}),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy(data_retention_days=7)),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={"count": 1},
        metadata={"retention_days": 120},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.retention_violation"


@pytest.mark.asyncio
async def test_policy_engine_requires_delegated_authority_when_enabled() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:crm.update": _manifest("crm.update")}),
        overlay_service=_FakeOverlayService(PolicyOverlayRecord(organization_id="org_demo")),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy(enforce_delegated_authority=True)),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(
                allowed=False,
                code="agentos.authority.no_active_delegation",
                reason="No active authority",
            )
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="crm.update",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.delegated_authority_required"


@pytest.mark.asyncio
async def test_policy_engine_normalizes_tool_id_against_overlay_denylist() -> None:
    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:email.send": _manifest("email.send")}),
        overlay_service=_FakeOverlayService(
            PolicyOverlayRecord(
                organization_id="org_demo",
                deny_tools=["EMAIL.SEND"],
            )
        ),
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=_FakeGovernanceService(_governance_policy()),
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="  EmAiL.SeNd  ",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.org_deny"


@pytest.mark.asyncio
async def test_policy_engine_applies_updated_emergency_denylist_without_restart() -> None:
    class _MutableOverlayService:
        def __init__(self, overlay: PolicyOverlayRecord) -> None:
            self.overlay = overlay

        async def get_overlay(self, *, organization_id: str) -> PolicyOverlayRecord:
            assert organization_id == self.overlay.organization_id
            return self.overlay

    overlay_service = _MutableOverlayService(PolicyOverlayRecord(organization_id="org_demo"))
    governance_service = _MutableGovernanceService(_governance_policy(kill_switch_enabled=False))

    engine = PolicyDecisionEngine(
        tool_registry=_FakeToolRegistry({"org_demo:email.send": _manifest("email.send")}),
        overlay_service=overlay_service,
        snapshot_compiler=_FakeSnapshotCompiler(_compiled_policy()),
        governance_service=governance_service,
        delegated_authority_service=_FakeDelegatedAuthorityService(
            DelegatedAuthorityEvaluation(allowed=True, code="ok", reason="ok")
        ),
    )

    first = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="email.send",
        evidence_refs={"count": 1},
    )
    assert first.action in {"allow", "require_approval"}

    overlay_service.overlay = PolicyOverlayRecord(
        organization_id="org_demo",
        emergency_denylist=["email.send"],
    )
    governance_service.policy = _governance_policy(kill_switch_enabled=True)

    second = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="email.send",
        evidence_refs={"count": 1},
    )
    assert second.action == "deny"
    assert second.code in {"agentos.policy.emergency_denylist", "agentos.policy.kill_switch"}
