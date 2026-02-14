from __future__ import annotations

import hashlib
from typing import Any

from src.kernel.serialization import json_dumps_canonical

from .cache import SnapshotCache
from .models import ConfigLintResult, DeploymentSnapshot
from .policy import PolicyCompiler
from .registry import AgentRegistryService


class DeploymentSnapshotCompiler:
    """Compile deterministic runtime snapshots for deployed agents."""

    def __init__(
        self,
        *,
        registry: AgentRegistryService | None = None,
        policy_compiler: PolicyCompiler | None = None,
        cache: SnapshotCache | None = None,
    ) -> None:
        self._registry = registry or AgentRegistryService()
        self._policy_compiler = policy_compiler or PolicyCompiler()
        self._cache = cache or SnapshotCache.get_instance()

    async def compile_for_deployment(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        force_refresh: bool = False,
    ) -> DeploymentSnapshot:
        if not force_refresh:
            cached = await self._cache.get(organization_id, deployment_id)
            if cached:
                return DeploymentSnapshot.model_validate(cached)

        deployment, role, profile, playbook, memory_scope, org_policy = await self._registry.resolve_deployment_bundle(
            organization_id=organization_id,
            deployment_id=deployment_id,
        )
        compiled_policy = self._policy_compiler.compile(profile=profile, organization_policy=org_policy)

        hash_payload = {
            "deployment_id": deployment.id,
            "version": deployment.version,
            "role": role.model_dump(mode="json"),
            "profile": profile.model_dump(mode="json"),
            "playbook": playbook.model_dump(mode="json"),
            "memory_scope": memory_scope.model_dump(mode="json"),
            "compiled_policy": compiled_policy.model_dump(mode="json"),
            "rollout_strategy": deployment.rollout_strategy,
        }
        snapshot_hash = hashlib.sha256(json_dumps_canonical(hash_payload).encode("utf-8")).hexdigest()

        snapshot = DeploymentSnapshot(
            deployment_id=deployment.id,
            organization_id=deployment.organization_id,
            role=role,
            profile=profile,
            playbook=playbook,
            memory_scope=memory_scope,
            compiled_policy=compiled_policy,
            rollout_strategy=deployment.rollout_strategy,
            snapshot_hash=snapshot_hash,
        )
        await self._cache.set(organization_id, deployment_id, snapshot.model_dump(mode="json"))
        return snapshot

    async def invalidate_snapshot(self, *, organization_id: str, deployment_id: str) -> None:
        await self._cache.invalidate(organization_id, deployment_id)

    async def lint_deployment_config(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        extra_tools: list[str] | None = None,
    ) -> ConfigLintResult:
        _, _, profile, playbook, memory_scope, org_policy = await self._registry.resolve_deployment_bundle(
            organization_id=organization_id,
            deployment_id=deployment_id,
        )
        return self._policy_compiler.lint_configuration(
            profile=profile,
            playbook=playbook,
            memory_scope=memory_scope,
            organization_policy=org_policy,
            extra_tools=extra_tools,
        )

    def lint_bundle(
        self,
        *,
        profile: Any,
        playbook: Any,
        memory_scope: Any,
        organization_policy: Any,
        extra_tools: list[str] | None = None,
    ) -> ConfigLintResult:
        return self._policy_compiler.lint_configuration(
            profile=profile,
            playbook=playbook,
            memory_scope=memory_scope,
            organization_policy=organization_policy,
            extra_tools=extra_tools,
        )

