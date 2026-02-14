from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import (
    AgentServicePrincipalRecord,
    DelegatedAuthorityEvaluation,
    DelegatedAuthorityRecord,
    ToolSideEffectTier,
)



def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)



def _normalize_tool_id(tool_id: str) -> str:
    return str(tool_id or "").strip().lower()



def _normalize_tool_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(
            code="agentos.authority.invalid_tool_list",
            message="allow_tools must be a list",
        )
    normalized: list[str] = []
    for item in value:
        tool = _normalize_tool_id(item)
        if tool:
            normalized.append(tool)
    return sorted(set(normalized))



def _normalize_tier_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(
            code="agentos.authority.invalid_tier_list",
            message="allow_side_effect_tiers must be a list",
        )
    normalized: list[str] = []
    for item in value:
        tier = str(item or "").strip().lower()
        if tier:
            normalized.append(tier)
    return sorted(set(normalized))



class ServicePrincipalService:
    """Lifecycle service for deployment-bound service principals."""

    async def ensure_principal_for_deployment(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        created_by_user_id: str | None,
        principal_name: str | None = None,
        allowed_scopes: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentServicePrincipalRecord:
        name = str(principal_name or f"agent-{deployment_id}").strip().lower()
        if not name:
            raise ValidationError(
                code="agentos.principal.invalid_name",
                message="principal_name cannot be empty",
            )

        scopes_payload = allowed_scopes or {}
        metadata_payload = metadata or {}
        if not isinstance(scopes_payload, dict):
            raise ValidationError(
                code="agentos.principal.invalid_scopes",
                message="allowed_scopes must be an object",
            )
        if not isinstance(metadata_payload, dict):
            raise ValidationError(
                code="agentos.principal.invalid_metadata",
                message="metadata must be an object",
            )

        async with get_db_session() as session:
            deployment_exists = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_deployment
                    WHERE id = :deployment_id
                      AND organization_id = :organization_id
                    """
                ),
                {
                    "deployment_id": deployment_id,
                    "organization_id": organization_id,
                },
            )
            if deployment_exists.fetchone() is None:
                raise NotFoundError(
                    code="agentos.principal.deployment_not_found",
                    message="Deployment not found for service principal",
                    meta={"deployment_id": deployment_id},
                )

            result = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_service_principal
                    WHERE deployment_id = :deployment_id
                    """
                ),
                {"deployment_id": deployment_id},
            )
            row = result.fetchone()
            principal_id = str(row.id) if row else new_prefixed_id("agsp")
            now = utc_now()
            await session.execute(
                text(
                    """
                    INSERT INTO agent_service_principal (
                        id, organization_id, deployment_id, principal_name, status,
                        allowed_scopes, metadata, created_by_user_id, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :deployment_id, :principal_name, 'active',
                        CAST(:allowed_scopes AS JSONB), CAST(:metadata AS JSONB),
                        :created_by_user_id, :created_at, :updated_at
                    )
                    ON CONFLICT (deployment_id)
                    DO UPDATE SET
                        principal_name = EXCLUDED.principal_name,
                        status = 'active',
                        allowed_scopes = EXCLUDED.allowed_scopes,
                        metadata = EXCLUDED.metadata,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": principal_id,
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "principal_name": name,
                    "allowed_scopes": json_dumps_canonical(scopes_payload),
                    "metadata": json_dumps_canonical(metadata_payload),
                    "created_by_user_id": created_by_user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        return await self.get_by_deployment(organization_id=organization_id, deployment_id=deployment_id)

    async def get_by_deployment(self, *, organization_id: str, deployment_id: str) -> AgentServicePrincipalRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, deployment_id, principal_name, status,
                           allowed_scopes, metadata, created_by_user_id,
                           created_at, updated_at
                    FROM agent_service_principal
                    WHERE organization_id = :organization_id
                      AND deployment_id = :deployment_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.principal.not_found",
                message="Service principal not found",
                meta={"deployment_id": deployment_id},
            )
        return AgentServicePrincipalRecord.model_validate(_row_to_dict(row))

    async def list_principals(
        self,
        *,
        organization_id: str,
        deployment_id: str | None = None,
        status: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[AgentServicePrincipalRecord]:
        query = """
            SELECT id, organization_id, deployment_id, principal_name, status,
                   allowed_scopes, metadata, created_by_user_id,
                   created_at, updated_at
            FROM agent_service_principal
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if deployment_id:
            query += " AND deployment_id = :deployment_id"
            params["deployment_id"] = deployment_id
        if status:
            query += " AND status = :status"
            params["status"] = str(status).strip().lower()
        query += " ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [AgentServicePrincipalRecord.model_validate(_row_to_dict(row)) for row in rows]


class DelegatedAuthorityService:
    """Delegated authority records for capability delegation to service principals."""

    async def grant_authority(
        self,
        *,
        organization_id: str,
        principal_id: str,
        authorized_by_user_id: str | None,
        authority_scope: dict[str, Any] | None = None,
        authority_reason: str | None = None,
        valid_from: datetime | None = None,
        valid_to: datetime | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DelegatedAuthorityRecord:
        scope_payload = dict(authority_scope or {})
        metadata_payload = metadata or {}
        if not isinstance(metadata_payload, dict):
            raise ValidationError(
                code="agentos.authority.invalid_metadata",
                message="metadata must be an object",
            )

        allow_tools = _normalize_tool_list(scope_payload.get("allow_tools"))
        allow_tiers = _normalize_tier_list(scope_payload.get("allow_side_effect_tiers"))
        if not allow_tools:
            allow_tools = ["*"]
        if "*" in allow_tools and len(allow_tools) > 1:
            allow_tools = ["*"]

        if allow_tiers and not set(allow_tiers).issubset(
            {"read_only", "low_risk_write", "high_risk_write", "external_commit"}
        ):
            raise ValidationError(
                code="agentos.authority.invalid_tier",
                message="allow_side_effect_tiers contains unsupported values",
            )

        scope_payload["allow_tools"] = allow_tools
        scope_payload["allow_side_effect_tiers"] = allow_tiers

        valid_from_value = valid_from or utc_now()
        if valid_to and valid_to <= valid_from_value:
            raise ValidationError(
                code="agentos.authority.invalid_window",
                message="valid_to must be greater than valid_from",
            )

        async with get_db_session() as session:
            principal_result = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_service_principal
                    WHERE id = :principal_id
                      AND organization_id = :organization_id
                    """
                ),
                {"principal_id": principal_id, "organization_id": organization_id},
            )
            if principal_result.fetchone() is None:
                raise NotFoundError(
                    code="agentos.authority.principal_not_found",
                    message="Service principal not found",
                    meta={"principal_id": principal_id},
                )

            authority_id = new_prefixed_id("agauth")
            await session.execute(
                text(
                    """
                    INSERT INTO agent_delegated_authority (
                        id, organization_id, principal_id, authorized_by_user_id,
                        authority_scope, authority_reason, valid_from, valid_to,
                        revoked_at, revoked_by_user_id, metadata, created_at
                    ) VALUES (
                        :id, :organization_id, :principal_id, :authorized_by_user_id,
                        CAST(:authority_scope AS JSONB), :authority_reason,
                        :valid_from, :valid_to, NULL, NULL,
                        CAST(:metadata AS JSONB), :created_at
                    )
                    """
                ),
                {
                    "id": authority_id,
                    "organization_id": organization_id,
                    "principal_id": principal_id,
                    "authorized_by_user_id": authorized_by_user_id,
                    "authority_scope": json_dumps_canonical(scope_payload),
                    "authority_reason": authority_reason,
                    "valid_from": valid_from_value,
                    "valid_to": valid_to,
                    "metadata": json_dumps_canonical(metadata_payload),
                    "created_at": utc_now(),
                },
            )
            await session.commit()
        return await self.get_authority(organization_id=organization_id, authority_id=authority_id)

    async def revoke_authority(
        self,
        *,
        organization_id: str,
        authority_id: str,
        revoked_by_user_id: str | None,
        reason: str | None = None,
    ) -> DelegatedAuthorityRecord:
        now = utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE agent_delegated_authority
                    SET revoked_at = :revoked_at,
                        revoked_by_user_id = :revoked_by_user_id,
                        metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB)
                    WHERE id = :id
                      AND organization_id = :organization_id
                      AND revoked_at IS NULL
                    RETURNING id
                    """
                ),
                {
                    "id": authority_id,
                    "organization_id": organization_id,
                    "revoked_at": now,
                    "revoked_by_user_id": revoked_by_user_id,
                    "metadata": json_dumps_canonical({"revocation_reason": reason} if reason else {}),
                },
            )
            row = result.fetchone()
            if row is None:
                exists = await session.execute(
                    text(
                        """
                        SELECT id
                        FROM agent_delegated_authority
                        WHERE id = :id
                          AND organization_id = :organization_id
                        """
                    ),
                    {"id": authority_id, "organization_id": organization_id},
                )
                if exists.fetchone() is None:
                    raise NotFoundError(
                        code="agentos.authority.not_found",
                        message="Delegated authority not found",
                        meta={"authority_id": authority_id},
                    )
            await session.commit()
        return await self.get_authority(organization_id=organization_id, authority_id=authority_id)

    async def get_authority(self, *, organization_id: str, authority_id: str) -> DelegatedAuthorityRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, principal_id, authorized_by_user_id,
                           authority_scope, authority_reason, valid_from, valid_to,
                           revoked_at, revoked_by_user_id, metadata, created_at
                    FROM agent_delegated_authority
                    WHERE id = :id
                      AND organization_id = :organization_id
                    """
                ),
                {"id": authority_id, "organization_id": organization_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.authority.not_found",
                message="Delegated authority not found",
                meta={"authority_id": authority_id},
            )
        return DelegatedAuthorityRecord.model_validate(_row_to_dict(row))

    async def list_authorities(
        self,
        *,
        organization_id: str,
        principal_id: str | None = None,
        active_only: bool = False,
        limit: int = 200,
        offset: int = 0,
    ) -> list[DelegatedAuthorityRecord]:
        query = """
            SELECT id, organization_id, principal_id, authorized_by_user_id,
                   authority_scope, authority_reason, valid_from, valid_to,
                   revoked_at, revoked_by_user_id, metadata, created_at
            FROM agent_delegated_authority
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
            "now": utc_now(),
        }
        if principal_id:
            query += " AND principal_id = :principal_id"
            params["principal_id"] = principal_id
        if active_only:
            query += " AND revoked_at IS NULL AND valid_from <= :now AND (valid_to IS NULL OR valid_to > :now)"
        query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [DelegatedAuthorityRecord.model_validate(_row_to_dict(row)) for row in rows]

    async def evaluate(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        tool_id: str,
        action_tier: ToolSideEffectTier,
        now: datetime | None = None,
    ) -> DelegatedAuthorityEvaluation:
        normalized_tool_id = _normalize_tool_id(tool_id)
        if not normalized_tool_id:
            return DelegatedAuthorityEvaluation(
                allowed=False,
                code="agentos.authority.tool_id_required",
                reason="Tool id is required for delegated authority evaluation",
            )

        check_time = now or utc_now()
        async with get_db_session() as session:
            principal_result = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_service_principal
                    WHERE organization_id = :organization_id
                      AND deployment_id = :deployment_id
                      AND status = 'active'
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                },
            )
            principal_row = principal_result.fetchone()
            if principal_row is None:
                return DelegatedAuthorityEvaluation(
                    allowed=False,
                    code="agentos.authority.principal_missing",
                    reason="No active service principal found for deployment",
                    metadata={"deployment_id": deployment_id},
                )
            principal_id = str(principal_row.id)

            authorities_result = await session.execute(
                text(
                    """
                    SELECT id, authority_scope
                    FROM agent_delegated_authority
                    WHERE organization_id = :organization_id
                      AND principal_id = :principal_id
                      AND revoked_at IS NULL
                      AND valid_from <= :now
                      AND (valid_to IS NULL OR valid_to > :now)
                    ORDER BY created_at DESC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "principal_id": principal_id,
                    "now": check_time,
                },
            )
            rows = authorities_result.fetchall()

        if not rows:
            return DelegatedAuthorityEvaluation(
                allowed=False,
                code="agentos.authority.no_active_delegation",
                reason="No active delegated authority was found for service principal",
                matched_principal_id=principal_id,
            )

        matched_authority_ids: list[str] = []
        for row in rows:
            payload = _row_to_dict(row)
            authority_id = str(payload.get("id") or "")
            scope = payload.get("authority_scope")
            if not isinstance(scope, dict):
                continue

            allow_tools = _normalize_tool_list(scope.get("allow_tools"))
            allow_tiers = _normalize_tier_list(scope.get("allow_side_effect_tiers"))
            deny_tools = _normalize_tool_list(scope.get("deny_tools"))

            if normalized_tool_id in set(deny_tools):
                continue

            tool_allowed = "*" in set(allow_tools) or normalized_tool_id in set(allow_tools)
            tier_allowed = not allow_tiers or str(action_tier) in set(allow_tiers)
            if tool_allowed and tier_allowed:
                matched_authority_ids.append(authority_id)

        if matched_authority_ids:
            return DelegatedAuthorityEvaluation(
                allowed=True,
                code="agentos.authority.allowed",
                reason="Delegated authority allowed tool execution",
                matched_authority_ids=matched_authority_ids,
                matched_principal_id=principal_id,
            )

        return DelegatedAuthorityEvaluation(
            allowed=False,
            code="agentos.authority.scope_mismatch",
            reason="Delegated authority does not include this tool or side-effect tier",
            matched_principal_id=principal_id,
        )
