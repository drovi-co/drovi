from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.agentos.control_plane import emit_control_plane_audit_event
from src.config import get_settings
from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .common import normalize_recipients, row_to_dict, slug
from .models import AgentChannelBindingRecord, AgentIdentityRecord, ChannelType


class AgentPresenceIdentityMixin:
    async def provision_identity(
        self,
        *,
        organization_id: str,
        display_name: str,
        identity_mode: str | None = None,
        deployment_id: str | None = None,
        role_id: str | None = None,
        profile_id: str | None = None,
        email_address: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor_id: str | None = None,
    ) -> AgentIdentityRecord:
        settings = get_settings()
        mode = identity_mode or settings.agent_identity_default_mode
        if mode not in {"virtual_persona", "dedicated_account"}:
            raise ValidationError(
                code="agentos.presence.invalid_identity_mode",
                message=f"Unsupported identity mode: {mode}",
            )

        normalized_email = (email_address or "").strip().lower() or None
        if mode == "virtual_persona" and not normalized_email:
            local_part = f"{slug(display_name)}-{new_prefixed_id('ag')[-6:]}"
            normalized_email = f"{local_part}@{settings.agent_identity_email_domain}"
        if mode == "dedicated_account" and not normalized_email:
            raise ValidationError(
                code="agentos.presence.email_required",
                message="Dedicated account mode requires email_address",
            )
        if normalized_email and "@" not in normalized_email:
            raise ValidationError(
                code="agentos.presence.invalid_email",
                message="Invalid identity email address",
            )

        identity_id = new_prefixed_id("agidn")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_identity (
                        id, organization_id, deployment_id, role_id, profile_id,
                        display_name, identity_mode, email_address, status, metadata,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :deployment_id, :role_id, :profile_id,
                        :display_name, :identity_mode, :email_address, 'active', CAST(:metadata AS JSONB),
                        :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": identity_id,
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "role_id": role_id,
                    "profile_id": profile_id,
                    "display_name": display_name,
                    "identity_mode": mode,
                    "email_address": normalized_email,
                    "metadata": json_dumps_canonical(metadata or {}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        identity = await self.get_identity(organization_id=organization_id, identity_id=identity_id)
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.identity.provisioned",
            actor_id=actor_id,
            resource_type="agent_identity",
            resource_id=identity_id,
            metadata={"identity_mode": mode, "email_address": identity.email_address},
        )
        return identity

    async def list_identities(
        self,
        *,
        organization_id: str,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AgentIdentityRecord]:
        query = """
            SELECT id, organization_id, deployment_id, role_id, profile_id,
                   display_name, identity_mode, email_address, status, metadata, created_at, updated_at
            FROM agent_identity
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if status:
            query += " AND status = :status"
            params["status"] = status
        query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [AgentIdentityRecord.model_validate(row_to_dict(row)) for row in rows]

    async def get_identity(self, *, organization_id: str, identity_id: str) -> AgentIdentityRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, deployment_id, role_id, profile_id,
                           display_name, identity_mode, email_address, status, metadata, created_at, updated_at
                    FROM agent_identity
                    WHERE organization_id = :organization_id
                      AND id = :id
                    """
                ),
                {"organization_id": organization_id, "id": identity_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.presence.identity_not_found",
                message="Agent identity not found",
                meta={"identity_id": identity_id},
            )
        return AgentIdentityRecord.model_validate(row_to_dict(row))

    async def upsert_channel_binding(
        self,
        *,
        organization_id: str,
        identity_id: str,
        channel_type: ChannelType,
        channel_target: str,
        channel_account_id: str | None = None,
        routing_mode: str = "auto",
        is_enabled: bool = True,
        config: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        actor_id: str | None = None,
    ) -> AgentChannelBindingRecord:
        if channel_type not in {"email", "slack", "teams"}:
            raise ValidationError(
                code="agentos.presence.invalid_channel_type",
                message=f"Unsupported channel type: {channel_type}",
            )
        await self.get_identity(organization_id=organization_id, identity_id=identity_id)
        binding_id = new_prefixed_id("agchb")
        now = utc_now()
        target = channel_target.strip()
        if not target:
            raise ValidationError(
                code="agentos.presence.channel_target_required",
                message="channel_target is required",
            )

        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_channel_binding (
                        id, organization_id, identity_id, channel_type, channel_target,
                        channel_account_id, routing_mode, is_enabled, config, metadata,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :identity_id, :channel_type, :channel_target,
                        :channel_account_id, :routing_mode, :is_enabled, CAST(:config AS JSONB), CAST(:metadata AS JSONB),
                        :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id, identity_id, channel_type, channel_target)
                    DO UPDATE SET
                        channel_account_id = EXCLUDED.channel_account_id,
                        routing_mode = EXCLUDED.routing_mode,
                        is_enabled = EXCLUDED.is_enabled,
                        config = EXCLUDED.config,
                        metadata = EXCLUDED.metadata,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": binding_id,
                    "organization_id": organization_id,
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "channel_target": target,
                    "channel_account_id": channel_account_id,
                    "routing_mode": routing_mode,
                    "is_enabled": is_enabled,
                    "config": json_dumps_canonical(config or {}),
                    "metadata": json_dumps_canonical(metadata or {}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        binding = await self.get_channel_binding(
            organization_id=organization_id,
            identity_id=identity_id,
            channel_type=channel_type,
            channel_target=target,
        )
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.channel_binding.upserted",
            actor_id=actor_id,
            resource_type="agent_channel_binding",
            resource_id=binding.id,
            metadata={"channel_type": channel_type, "channel_target": channel_target},
        )
        return binding

    async def get_channel_binding(
        self,
        *,
        organization_id: str,
        identity_id: str,
        channel_type: ChannelType,
        channel_target: str,
    ) -> AgentChannelBindingRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, channel_target,
                           channel_account_id, routing_mode, is_enabled, config, metadata, created_at, updated_at
                    FROM agent_channel_binding
                    WHERE organization_id = :organization_id
                      AND identity_id = :identity_id
                      AND channel_type = :channel_type
                      AND channel_target = :channel_target
                    """
                ),
                {
                    "organization_id": organization_id,
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "channel_target": channel_target,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.presence.binding_not_found",
                message="Agent channel binding not found",
                meta={"identity_id": identity_id, "channel_type": channel_type, "channel_target": channel_target},
            )
        return AgentChannelBindingRecord.model_validate(row_to_dict(row))

    async def list_channel_bindings(
        self,
        *,
        organization_id: str,
        identity_id: str | None = None,
        channel_type: ChannelType | None = None,
        include_disabled: bool = False,
        limit: int = 200,
        offset: int = 0,
    ) -> list[AgentChannelBindingRecord]:
        query = """
            SELECT id, organization_id, identity_id, channel_type, channel_target,
                   channel_account_id, routing_mode, is_enabled, config, metadata, created_at, updated_at
            FROM agent_channel_binding
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if identity_id:
            query += " AND identity_id = :identity_id"
            params["identity_id"] = identity_id
        if channel_type:
            query += " AND channel_type = :channel_type"
            params["channel_type"] = channel_type
        if not include_disabled:
            query += " AND is_enabled = TRUE"
        query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [AgentChannelBindingRecord.model_validate(row_to_dict(row)) for row in rows]

    async def _resolve_identity_and_binding(
        self,
        *,
        organization_id: str,
        channel_type: ChannelType,
        identity_id: str | None,
        channel_target: str | None,
        recipients: list[str] | None,
    ) -> tuple[AgentIdentityRecord, AgentChannelBindingRecord]:
        if identity_id:
            identity = await self.get_identity(organization_id=organization_id, identity_id=identity_id)
            target = channel_target or self._default_target_for_channel(channel_type=channel_type, recipients=recipients)
            binding = await self._find_binding_by_target(
                organization_id=organization_id,
                identity_id=identity_id,
                channel_type=channel_type,
                channel_target=target,
            )
            return identity, binding

        candidate_target = channel_target or self._default_target_for_channel(channel_type=channel_type, recipients=recipients)
        binding = await self._find_binding_for_inbound_target(
            organization_id=organization_id,
            channel_type=channel_type,
            channel_target=candidate_target,
        )
        identity = await self.get_identity(organization_id=organization_id, identity_id=binding.identity_id)
        return identity, binding

    async def _find_binding_for_inbound_target(
        self,
        *,
        organization_id: str,
        channel_type: ChannelType,
        channel_target: str,
    ) -> AgentChannelBindingRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, channel_target,
                           channel_account_id, routing_mode, is_enabled, config, metadata, created_at, updated_at
                    FROM agent_channel_binding
                    WHERE organization_id = :organization_id
                      AND channel_type = :channel_type
                      AND channel_target = :channel_target
                      AND is_enabled = TRUE
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "organization_id": organization_id,
                    "channel_type": channel_type,
                    "channel_target": channel_target,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.presence.binding_not_found",
                message="No enabled binding found for inbound target",
                meta={"channel_type": channel_type, "channel_target": channel_target},
            )
        return AgentChannelBindingRecord.model_validate(row_to_dict(row))

    async def _find_binding_by_target(
        self,
        *,
        organization_id: str,
        identity_id: str,
        channel_type: ChannelType,
        channel_target: str,
    ) -> AgentChannelBindingRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, channel_target,
                           channel_account_id, routing_mode, is_enabled, config, metadata, created_at, updated_at
                    FROM agent_channel_binding
                    WHERE organization_id = :organization_id
                      AND identity_id = :identity_id
                      AND channel_type = :channel_type
                      AND channel_target = :channel_target
                      AND is_enabled = TRUE
                    LIMIT 1
                    """
                ),
                {
                    "organization_id": organization_id,
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "channel_target": channel_target,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.presence.binding_not_found",
                message="No channel binding for identity/target",
                meta={
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "channel_target": channel_target,
                },
            )
        return AgentChannelBindingRecord.model_validate(row_to_dict(row))

    async def _resolve_thread_binding(
        self,
        *,
        organization_id: str,
        thread: Any,
    ) -> AgentChannelBindingRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, channel_target,
                           channel_account_id, routing_mode, is_enabled, config, metadata, created_at, updated_at
                    FROM agent_channel_binding
                    WHERE organization_id = :organization_id
                      AND identity_id = :identity_id
                      AND channel_type = :channel_type
                      AND is_enabled = TRUE
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "organization_id": organization_id,
                    "identity_id": thread.identity_id,
                    "channel_type": thread.channel_type,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.presence.binding_not_found",
                message="No active channel binding for thread identity",
                meta={"thread_id": thread.id, "identity_id": thread.identity_id},
            )
        return AgentChannelBindingRecord.model_validate(row_to_dict(row))

    def _default_target_for_channel(self, *, channel_type: ChannelType, recipients: list[str] | None) -> str:
        if channel_type == "email":
            normalized = normalize_recipients(recipients)
            if not normalized:
                raise ValidationError(
                    code="agentos.presence.email_target_required",
                    message="Email channel requires recipient route target",
                )
            return normalized[0]
        raise ValidationError(
            code="agentos.presence.channel_target_required",
            message=f"channel_target is required for {channel_type}",
        )
