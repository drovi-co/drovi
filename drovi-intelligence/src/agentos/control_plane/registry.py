from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError

from .models import (
    AgentMemoryScopeRecord,
    AgentPlaybookRecord,
    AgentProfileRecord,
    AgentRoleRecord,
    DeploymentRecord,
    OrganizationPolicyRecord,
    TriggerRecord,
)


def _row_to_dict(row: Any) -> dict[str, Any]:
    payload = dict(row._mapping if hasattr(row, "_mapping") else row)
    return payload


class AgentRegistryService:
    """Lookup and version resolution for AgentOS control plane."""

    async def resolve_active_deployment(
        self,
        *,
        organization_id: str,
        role_id: str,
    ) -> DeploymentRecord | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, profile_id, playbook_id, version, status,
                           rollout_strategy, snapshot_hash, published_at, created_by_user_id,
                           created_at, updated_at
                    FROM agent_deployment
                    WHERE organization_id = :organization_id
                      AND role_id = :role_id
                      AND status = 'active'
                    ORDER BY version DESC
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "role_id": role_id},
            )
            row = result.fetchone()
        return DeploymentRecord.model_validate(_row_to_dict(row)) if row else None

    async def resolve_deployment_bundle(
        self,
        *,
        organization_id: str,
        deployment_id: str,
    ) -> tuple[
        DeploymentRecord,
        AgentRoleRecord,
        AgentProfileRecord,
        AgentPlaybookRecord,
        AgentMemoryScopeRecord,
        OrganizationPolicyRecord,
    ]:
        async with get_db_session() as session:
            deployment_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, profile_id, playbook_id, version, status,
                           rollout_strategy, snapshot_hash, published_at, created_by_user_id,
                           created_at, updated_at
                    FROM agent_deployment
                    WHERE id = :deployment_id AND organization_id = :organization_id
                    """
                ),
                {"deployment_id": deployment_id, "organization_id": organization_id},
            )
            deployment_row = deployment_result.fetchone()
            if deployment_row is None:
                raise NotFoundError(
                    code="agentos.deployment.not_found",
                    message="Deployment not found",
                    meta={"deployment_id": deployment_id},
                )
            deployment = DeploymentRecord.model_validate(_row_to_dict(deployment_row))

            role_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_key, name, description, domain, status, metadata
                    FROM agent_role
                    WHERE id = :role_id AND organization_id = :organization_id
                    """
                ),
                {"role_id": deployment.role_id, "organization_id": organization_id},
            )
            role_row = role_result.fetchone()
            if role_row is None:
                raise NotFoundError(
                    code="agentos.role.not_found",
                    message="Role not found for deployment",
                    meta={"role_id": deployment.role_id},
                )
            role = AgentRoleRecord.model_validate(_row_to_dict(role_row))

            profile_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                           permission_scope, metadata
                    FROM agent_profile
                    WHERE id = :profile_id AND organization_id = :organization_id
                    """
                ),
                {"profile_id": deployment.profile_id, "organization_id": organization_id},
            )
            profile_row = profile_result.fetchone()
            if profile_row is None:
                raise NotFoundError(
                    code="agentos.profile.not_found",
                    message="Profile not found for deployment",
                    meta={"profile_id": deployment.profile_id},
                )
            profile = AgentProfileRecord.model_validate(_row_to_dict(profile_row))

            playbook_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, version, name, objective, constraints, sop,
                           success_criteria, escalation_policy, dsl, status
                    FROM agent_playbook
                    WHERE id = :playbook_id AND organization_id = :organization_id
                    """
                ),
                {"playbook_id": deployment.playbook_id, "organization_id": organization_id},
            )
            playbook_row = playbook_result.fetchone()
            if playbook_row is None:
                raise NotFoundError(
                    code="agentos.playbook.not_found",
                    message="Playbook not found for deployment",
                    meta={"playbook_id": deployment.playbook_id},
                )
            playbook = AgentPlaybookRecord.model_validate(_row_to_dict(playbook_row))

            if profile.role_id != role.id:
                raise ValidationError(
                    code="agentos.profile.role_mismatch",
                    message="Profile role mismatch",
                    meta={"profile_role_id": profile.role_id, "role_id": role.id},
                )
            if playbook.role_id != role.id:
                raise ValidationError(
                    code="agentos.playbook.role_mismatch",
                    message="Playbook role mismatch",
                    meta={"playbook_role_id": playbook.role_id, "role_id": role.id},
                )

            memory_result = await session.execute(
                text(
                    """
                    SELECT readable_scopes, writable_scopes, retention_policy
                    FROM agent_memory_scope
                    WHERE organization_id = :organization_id AND role_id = :role_id
                    """
                ),
                {"organization_id": organization_id, "role_id": role.id},
            )
            memory_row = memory_result.fetchone()
            memory_scope = (
                AgentMemoryScopeRecord.model_validate(_row_to_dict(memory_row))
                if memory_row
                else AgentMemoryScopeRecord()
            )

            org_result = await session.execute(
                text(
                    """
                    SELECT id, allowed_connectors, default_connection_visibility
                    FROM organizations
                    WHERE id = :organization_id
                    """
                ),
                {"organization_id": organization_id},
            )
            org_row = org_result.fetchone()
            if org_row is None:
                org_policy = OrganizationPolicyRecord(organization_id=organization_id)
            else:
                org_payload = _row_to_dict(org_row)
                org_policy = OrganizationPolicyRecord(
                    organization_id=str(org_payload["id"]),
                    allowed_connectors=list(org_payload.get("allowed_connectors") or []),
                    default_connection_visibility=org_payload.get("default_connection_visibility"),
                )

        return deployment, role, profile, playbook, memory_scope, org_policy

    async def list_enabled_triggers(
        self,
        *,
        organization_id: str,
        deployment_id: str | None = None,
    ) -> list[TriggerRecord]:
        query = """
            SELECT t.id, t.organization_id, t.deployment_id, t.trigger_type, t.trigger_spec,
                   t.is_enabled, t.updated_at, d.status AS deployment_status
            FROM agent_trigger t
            INNER JOIN agent_deployment d ON d.id = t.deployment_id
            WHERE t.organization_id = :organization_id
              AND t.is_enabled = TRUE
              AND d.status IN ('active', 'canary', 'draft')
        """
        params: dict[str, Any] = {"organization_id": organization_id}
        if deployment_id:
            query += " AND t.deployment_id = :deployment_id"
            params["deployment_id"] = deployment_id
        query += " ORDER BY t.updated_at DESC"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()

        return [TriggerRecord.model_validate(_row_to_dict(row)) for row in rows]

