from __future__ import annotations

import pytest

from src.agentos.control_plane.models import (
    CompiledPolicy,
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
    )

    decision = await engine.decide(
        organization_id="org_demo",
        deployment_id="agdep_1",
        tool_id="browser.undocumented",
        evidence_refs={"count": 1},
    )

    assert decision.action == "deny"
    assert decision.code == "agentos.policy.tool_unregistered"
