from __future__ import annotations

import hashlib
from typing import Any

from src.actuation import load_builtin_drivers
from src.actuation.registry import list_drivers
from src.kernel.errors import ValidationError
from src.kernel.serialization import json_dumps_canonical

from .models import (
    AgentMemoryScopeRecord,
    AgentPlaybookRecord,
    AgentProfileRecord,
    CompiledPolicy,
    ConfigLintResult,
    OrganizationPolicyRecord,
)


class PolicyCompiler:
    """Compile and lint effective policy from profile + org overlays."""

    def __init__(self) -> None:
        load_builtin_drivers()

    def available_tools(self, extra_tools: list[str] | None = None) -> list[str]:
        base = set(list_drivers())
        base.update(
            {
                "browser",
                "browser.navigate",
                "browser.snapshot",
                "browser.click",
                "browser.type",
                "browser.download",
                "browser.upload",
                "documents.ask",
                "memory.timeline",
                "memory.search",
                "webhook",
                "api",
                "desktop",
                "desktop.fs.read",
                "desktop.fs.write",
                "desktop.fs.list",
                "desktop.fs.delete",
                "desktop.app.launch",
                "desktop.app.automate",
                "desktop.screen.capture",
                "desktop.secret.get",
                "desktop.secret.set",
                "desktop.secret.list",
            }
        )
        if extra_tools:
            base.update(extra_tools)
        return sorted(base)

    def compile(
        self,
        *,
        profile: AgentProfileRecord,
        organization_policy: OrganizationPolicyRecord,
        extra_overrides: dict[str, Any] | None = None,
    ) -> CompiledPolicy:
        overrides = extra_overrides or {}

        allowed_tools = set(profile.permission_scope.tools)
        denied_tools = set()

        tool_policy = profile.tool_policy or {}
        allowed_tools.update(tool_policy.get("allow_tools", []))
        denied_tools.update(tool_policy.get("deny_tools", []))

        org_overrides = organization_policy.policy_overrides or {}
        allowed_tools.update(org_overrides.get("allow_tools", []))
        denied_tools.update(org_overrides.get("deny_tools", []))
        allowed_tools.update(overrides.get("allow_tools", []))
        denied_tools.update(overrides.get("deny_tools", []))

        allowed_connectors = set(organization_policy.allowed_connectors or [])
        if allowed_connectors:
            allowed_tools = {
                tool
                for tool in allowed_tools
                if tool in allowed_connectors or tool.split(".", 1)[0] in allowed_connectors
            }

        # Deny always wins.
        allowed_tools -= denied_tools

        allow_external_send = bool(profile.permission_scope.allow_external_send)
        if "allow_external_send" in org_overrides:
            allow_external_send = allow_external_send and bool(org_overrides["allow_external_send"])
        if "allow_external_send" in overrides:
            allow_external_send = allow_external_send and bool(overrides["allow_external_send"])

        allowed_domains = set(profile.permission_scope.allowed_domains)
        org_domains = set(org_overrides.get("allowed_domains", []))
        if org_domains and allowed_domains:
            allowed_domains = allowed_domains.intersection(org_domains)
        elif org_domains:
            allowed_domains = org_domains

        if "allowed_domains" in overrides:
            allowed_domains = allowed_domains.intersection(set(overrides.get("allowed_domains") or []))

        payload = {
            "autonomy_tier": profile.autonomy_tier,
            "allowed_tools": sorted(allowed_tools),
            "denied_tools": sorted(denied_tools),
            "allowed_sources": sorted(set(profile.permission_scope.sources)),
            "allowed_channels": sorted(set(profile.permission_scope.channels)),
            "allow_external_send": allow_external_send,
            "allowed_domains": sorted(allowed_domains),
            "organization_policy": {
                "allowed_connectors": organization_policy.allowed_connectors,
                "default_connection_visibility": organization_policy.default_connection_visibility,
                "policy_overrides": organization_policy.policy_overrides,
            },
        }
        policy_hash = hashlib.sha256(json_dumps_canonical(payload).encode("utf-8")).hexdigest()
        return CompiledPolicy.model_validate({**payload, "policy_hash": policy_hash})

    def lint_configuration(
        self,
        *,
        profile: AgentProfileRecord,
        playbook: AgentPlaybookRecord,
        memory_scope: AgentMemoryScopeRecord,
        organization_policy: OrganizationPolicyRecord,
        extra_tools: list[str] | None = None,
    ) -> ConfigLintResult:
        errors: list[str] = []
        warnings: list[str] = []

        compiled = self.compile(
            profile=profile,
            organization_policy=organization_policy,
        )
        available_tools = set(self.available_tools(extra_tools=extra_tools))
        known_tools = available_tools.union(compiled.allowed_tools).union(compiled.denied_tools)

        overlap = set(compiled.allowed_tools).intersection(compiled.denied_tools)
        if overlap:
            errors.append(f"Tools cannot be both allowed and denied: {sorted(overlap)}")

        required_tools = set(playbook.constraints.get("required_tools", []))
        if required_tools:
            unknown_required = sorted(required_tools - known_tools)
            if unknown_required:
                errors.append(f"Unknown required tools: {unknown_required}")

            missing_permissions = sorted(required_tools - set(compiled.allowed_tools))
            if missing_permissions:
                errors.append(f"Required tools are not allowed by policy: {missing_permissions}")

        forbidden_tools = set(playbook.constraints.get("forbidden_tools", []))
        if forbidden_tools:
            forbidden_but_allowed = sorted(forbidden_tools.intersection(compiled.allowed_tools))
            if forbidden_but_allowed:
                errors.append(f"forbidden_tools are still allowed: {forbidden_but_allowed}")

        required_read_scopes = set(playbook.constraints.get("required_read_scopes", []))
        if required_read_scopes:
            missing_read_scopes = sorted(required_read_scopes - set(memory_scope.readable_scopes))
            if missing_read_scopes:
                errors.append(f"Missing readable memory scopes: {missing_read_scopes}")

        required_write_scopes = set(playbook.constraints.get("required_write_scopes", []))
        if required_write_scopes:
            missing_write_scopes = sorted(required_write_scopes - set(memory_scope.writable_scopes))
            if missing_write_scopes:
                errors.append(f"Missing writable memory scopes: {missing_write_scopes}")

        sop_steps = playbook.sop.get("steps", [])
        if not isinstance(sop_steps, list) or len(sop_steps) == 0:
            warnings.append("Playbook SOP has no explicit steps.")
        else:
            for index, step in enumerate(sop_steps):
                action = (step or {}).get("action")
                if action and action not in known_tools:
                    warnings.append(f"SOP step {index + 1} references non-standard action `{action}`.")

        if profile.autonomy_tier in {"L3", "L4"} and not playbook.escalation_policy:
            warnings.append("High-autonomy profiles should define explicit escalation_policy.")

        return ConfigLintResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            compiled_policy=compiled,
        )

    def assert_tool_allowed(self, *, compiled_policy: CompiledPolicy, tool_id: str) -> None:
        if tool_id in compiled_policy.denied_tools:
            raise ValidationError(
                code="agentos.policy.tool_denied",
                message=f"Tool is denied by policy: {tool_id}",
                meta={"tool_id": tool_id},
            )
        if compiled_policy.allowed_tools and tool_id not in compiled_policy.allowed_tools:
            raise ValidationError(
                code="agentos.policy.tool_not_allowed",
                message=f"Tool is not allowed by policy: {tool_id}",
                meta={"tool_id": tool_id},
            )
