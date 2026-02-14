from __future__ import annotations

from typing import Any

from src.kernel.errors import NotFoundError

from .compiler import DeploymentSnapshotCompiler
from .governance_policy import GovernancePolicyService
from .models import CompiledPolicy, PolicyDecisionRecord, ToolManifestRecord, ToolSideEffectTier
from .policy_overlay import PolicyOverlayService
from .service_principals import DelegatedAuthorityService
from .tool_registry import ToolRegistryService


def _has_evidence(evidence_refs: dict[str, Any]) -> bool:
    if not evidence_refs:
        return False
    count = evidence_refs.get("count")
    if isinstance(count, (int, float)) and count > 0:
        return True
    for key in ("items", "quotes", "spans", "references"):
        values = evidence_refs.get(key)
        if isinstance(values, list) and len(values) > 0:
            return True
    return False


def _action_tier(manifest: ToolManifestRecord | None) -> ToolSideEffectTier:
    if manifest is None:
        return "read_only"
    return manifest.side_effect_tier


def _normalize_tool_id(tool_id: str) -> str:
    return str(tool_id or "").strip().lower()


def _normalize_region(region: Any) -> str:
    return str(region or "").strip().lower()


class PolicyDecisionEngine:
    """Runtime policy decision engine for tool execution."""

    def __init__(
        self,
        *,
        tool_registry: ToolRegistryService | None = None,
        overlay_service: PolicyOverlayService | None = None,
        snapshot_compiler: DeploymentSnapshotCompiler | None = None,
        governance_service: GovernancePolicyService | None = None,
        delegated_authority_service: DelegatedAuthorityService | None = None,
    ) -> None:
        self._tool_registry = tool_registry or ToolRegistryService()
        self._overlay_service = overlay_service or PolicyOverlayService()
        self._snapshot_compiler = snapshot_compiler or DeploymentSnapshotCompiler()
        self._governance_service = governance_service or GovernancePolicyService()
        self._delegated_authority_service = delegated_authority_service or DelegatedAuthorityService()

    async def decide(
        self,
        *,
        organization_id: str,
        tool_id: str,
        deployment_id: str | None = None,
        compiled_policy: CompiledPolicy | None = None,
        evidence_refs: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> PolicyDecisionRecord:
        tool_id = _normalize_tool_id(tool_id)
        evidence_refs = evidence_refs or {}
        metadata = metadata or {}
        if not tool_id:
            return PolicyDecisionRecord(
                action="allow",
                code="agentos.policy.no_tool_context",
                reason="No tool context provided; policy engine skipped",
                reasons=[],
                tool_id="",
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier="read_only",
                policy_hash=compiled_policy.policy_hash if compiled_policy else None,
                metadata=metadata,
            )

        effective_policy = compiled_policy
        if effective_policy is None and deployment_id:
            snapshot = await self._snapshot_compiler.compile_for_deployment(
                organization_id=organization_id,
                deployment_id=deployment_id,
                force_refresh=False,
            )
            effective_policy = snapshot.compiled_policy

        overlay = await self._overlay_service.get_overlay(organization_id=organization_id)
        governance_policy = await self._governance_service.get_policy(organization_id=organization_id)
        manifest: ToolManifestRecord | None = None
        try:
            manifest = await self._tool_registry.get_manifest(organization_id=organization_id, tool_id=tool_id)
            if not manifest.is_enabled:
                return PolicyDecisionRecord(
                    action="deny",
                    code="agentos.policy.tool_disabled",
                    reason="Tool manifest is disabled",
                    reasons=["tool_manifest_disabled"],
                    tool_id=tool_id,
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    action_tier=manifest.side_effect_tier,
                    policy_hash=effective_policy.policy_hash if effective_policy else None,
                    requires_evidence=manifest.requires_evidence,
                    high_stakes=manifest.high_stakes,
                    metadata={**metadata, "tool_manifest_id": manifest.id},
                )
        except NotFoundError:
            manifest = None

        reasons: list[str] = []
        action_tier = _action_tier(manifest)
        overlay_allow_tools = {_normalize_tool_id(item) for item in overlay.allow_tools}
        overlay_deny_tools = {_normalize_tool_id(item) for item in overlay.deny_tools}
        overlay_require_approval_tools = {_normalize_tool_id(item) for item in overlay.require_approval_tools}
        overlay_emergency_denylist = {_normalize_tool_id(item) for item in overlay.emergency_denylist}
        deployment_allowed_tools = (
            {_normalize_tool_id(item) for item in effective_policy.allowed_tools}
            if effective_policy
            else set()
        )
        deployment_denied_tools = (
            {_normalize_tool_id(item) for item in effective_policy.denied_tools}
            if effective_policy
            else set()
        )
        governance_metadata = {
            "governance_policy": {
                "residency_region": governance_policy.residency_region,
                "allowed_regions": governance_policy.allowed_regions,
                "data_retention_days": governance_policy.data_retention_days,
                "evidence_retention_days": governance_policy.evidence_retention_days,
                "require_residency_enforcement": governance_policy.require_residency_enforcement,
                "enforce_delegated_authority": governance_policy.enforce_delegated_authority,
                "kill_switch_enabled": governance_policy.kill_switch_enabled,
            }
        }

        if governance_policy.kill_switch_enabled and action_tier != "read_only":
            reasons.append("governance_kill_switch")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.kill_switch",
                reason="Agent kill switch is enabled for side-effect actions",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                high_stakes=bool(manifest.high_stakes) if manifest else False,
                metadata={**metadata, **governance_metadata},
            )

        if governance_policy.require_residency_enforcement:
            allowed_regions = {_normalize_region(region) for region in governance_policy.allowed_regions}
            residency_region = _normalize_region(governance_policy.residency_region)
            if residency_region and residency_region != "global":
                allowed_regions.add(residency_region)
            target_region = _normalize_region(metadata.get("target_region") or metadata.get("region"))
            if target_region and allowed_regions and target_region not in allowed_regions:
                reasons.append("governance_residency")
                return PolicyDecisionRecord(
                    action="deny",
                    code="agentos.policy.residency_violation",
                    reason=f"Target region `{target_region}` violates governance residency policy",
                    reasons=reasons,
                    tool_id=tool_id,
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    action_tier=action_tier,
                    policy_hash=effective_policy.policy_hash if effective_policy else None,
                    requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                    high_stakes=bool(manifest.high_stakes) if manifest else False,
                    metadata={**metadata, **governance_metadata},
                )

        requested_retention_days: int | None = None
        for key in ("retention_days", "data_retention_days", "requested_retention_days"):
            value = metadata.get(key)
            if value is None:
                continue
            try:
                requested_retention_days = int(value)
            except Exception:
                requested_retention_days = None
            break
        if (
            requested_retention_days is not None
            and requested_retention_days > 0
            and requested_retention_days > governance_policy.data_retention_days
        ):
            reasons.append("governance_retention")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.retention_violation",
                reason=(
                    f"Requested retention ({requested_retention_days} days) exceeds "
                    f"policy limit ({governance_policy.data_retention_days} days)"
                ),
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                high_stakes=bool(manifest.high_stakes) if manifest else False,
                metadata={**metadata, **governance_metadata},
            )

        if governance_policy.enforce_delegated_authority and action_tier != "read_only":
            if not deployment_id:
                reasons.append("delegated_authority_missing_deployment")
                return PolicyDecisionRecord(
                    action="deny",
                    code="agentos.policy.delegated_authority_required",
                    reason="Deployment id is required when delegated authority enforcement is enabled",
                    reasons=reasons,
                    tool_id=tool_id,
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    action_tier=action_tier,
                    policy_hash=effective_policy.policy_hash if effective_policy else None,
                    requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                    high_stakes=bool(manifest.high_stakes) if manifest else False,
                    metadata={**metadata, **governance_metadata},
                )
            authority = await self._delegated_authority_service.evaluate(
                organization_id=organization_id,
                deployment_id=deployment_id,
                tool_id=tool_id,
                action_tier=action_tier,
            )
            if not authority.allowed:
                reasons.append("delegated_authority_denied")
                return PolicyDecisionRecord(
                    action="deny",
                    code="agentos.policy.delegated_authority_required",
                    reason=authority.reason,
                    reasons=reasons,
                    tool_id=tool_id,
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    action_tier=action_tier,
                    policy_hash=effective_policy.policy_hash if effective_policy else None,
                    requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                    high_stakes=bool(manifest.high_stakes) if manifest else False,
                    metadata={
                        **metadata,
                        **governance_metadata,
                        "delegated_authority": authority.model_dump(mode="json"),
                    },
                )

        if tool_id in overlay_emergency_denylist:
            reasons.append("emergency_denylist")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.emergency_denylist",
                reason="Tool denied by emergency denylist",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=bool(manifest.requires_evidence) if manifest else False,
                high_stakes=bool(manifest.high_stakes) if manifest else False,
                metadata={**metadata, **governance_metadata},
            )

        if manifest is None:
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.tool_unregistered",
                reason="Tool is not registered in tool manifest",
                reasons=["tool_manifest_missing"],
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                metadata=metadata,
            )

        if tool_id in overlay_deny_tools:
            reasons.append("org_overlay_deny")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.org_deny",
                reason="Tool denied by organization policy overlay",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if effective_policy and tool_id in deployment_denied_tools:
            reasons.append("deployment_policy_deny")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.deployment_deny",
                reason="Tool denied by deployment policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if effective_policy and effective_policy.allowed_tools:
            allowed_tools = deployment_allowed_tools.union(overlay_allow_tools)
            if tool_id not in allowed_tools:
                reasons.append("deployment_allowlist")
                return PolicyDecisionRecord(
                    action="deny",
                    code="agentos.policy.not_allowed",
                    reason="Tool not in deployment allowlist",
                    reasons=reasons,
                    tool_id=tool_id,
                    organization_id=organization_id,
                    deployment_id=deployment_id,
                    action_tier=action_tier,
                    policy_hash=effective_policy.policy_hash,
                    requires_evidence=manifest.requires_evidence,
                    high_stakes=manifest.high_stakes,
                    metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
                )

        if (manifest.requires_evidence or manifest.high_stakes) and not _has_evidence(evidence_refs):
            reasons.append("missing_evidence")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.no_evidence_no_action",
                reason="No evidence provided for high-stakes action",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        require_approval_tools = overlay_require_approval_tools
        if tool_id in require_approval_tools:
            reasons.append("org_overlay_requires_approval")
            return PolicyDecisionRecord(
                action="require_approval",
                code="agentos.policy.requires_approval",
                reason="Tool requires human approval by organization policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if manifest.default_policy_action == "require_approval":
            reasons.append("tool_manifest_requires_approval")
            return PolicyDecisionRecord(
                action="require_approval",
                code="agentos.policy.requires_approval",
                reason="Tool requires human approval by manifest policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if manifest.default_policy_action == "deny":
            reasons.append("tool_manifest_default_deny")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.default_deny",
                reason="Tool denied by manifest default policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if overlay.default_policy_action == "deny" and tool_id not in overlay_allow_tools:
            reasons.append("org_overlay_default_deny")
            return PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.org_default_deny",
                reason="Tool denied by organization default policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        if overlay.default_policy_action == "require_approval" and tool_id not in overlay_allow_tools:
            reasons.append("org_overlay_default_approval")
            return PolicyDecisionRecord(
                action="require_approval",
                code="agentos.policy.requires_approval",
                reason="Tool requires approval by organization default policy",
                reasons=reasons,
                tool_id=tool_id,
                organization_id=organization_id,
                deployment_id=deployment_id,
                action_tier=action_tier,
                policy_hash=effective_policy.policy_hash if effective_policy else None,
                requires_evidence=manifest.requires_evidence,
                high_stakes=manifest.high_stakes,
                metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
            )

        reasons.append("allowed")
        return PolicyDecisionRecord(
            action="allow",
            code="agentos.policy.allowed",
            reason="Tool allowed by effective policy",
            reasons=reasons,
            tool_id=tool_id,
            organization_id=organization_id,
            deployment_id=deployment_id,
            action_tier=action_tier,
            policy_hash=effective_policy.policy_hash if effective_policy else None,
            requires_evidence=manifest.requires_evidence,
            high_stakes=manifest.high_stakes,
            metadata={**metadata, **governance_metadata, "tool_manifest_id": manifest.id},
        )
