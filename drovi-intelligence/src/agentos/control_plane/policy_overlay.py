from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import ValidationError
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import PolicyDecisionAction, PolicyOverlayRecord

_VALID_POLICY_ACTIONS: set[PolicyDecisionAction] = {"allow", "deny", "require_approval"}


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


def _normalize_tool_list(value: Any, *, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(
            code="agentos.policy.overlay.invalid_list",
            message=f"{field_name} must be a list of tool ids",
            meta={"field": field_name},
        )
    tools: list[str] = []
    for item in value:
        tool_id = str(item or "").strip().lower()
        if not tool_id:
            continue
        tools.append(tool_id)
    return sorted(set(tools))


class PolicyOverlayService:
    """Per-organization overlay for runtime tool decisions."""

    async def get_overlay(self, *, organization_id: str) -> PolicyOverlayRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT organization_id, allow_tools, deny_tools, require_approval_tools,
                           emergency_denylist, default_policy_action, metadata, updated_by_user_id,
                           created_at, updated_at
                    FROM agent_org_policy_overlay
                    WHERE organization_id = :organization_id
                    """
                ),
                {"organization_id": organization_id},
            )
            row = result.fetchone()

        if row is None:
            return PolicyOverlayRecord(organization_id=organization_id)
        return PolicyOverlayRecord.model_validate(_row_to_dict(row))

    async def upsert_overlay(
        self,
        *,
        organization_id: str,
        overlay: PolicyOverlayRecord | dict[str, Any],
        updated_by_user_id: str | None,
    ) -> PolicyOverlayRecord:
        payload = overlay.model_dump(mode="json") if isinstance(overlay, PolicyOverlayRecord) else dict(overlay)
        payload["organization_id"] = organization_id

        default_action = str(payload.get("default_policy_action") or "allow")
        if default_action not in _VALID_POLICY_ACTIONS:
            raise ValidationError(
                code="agentos.policy.overlay.invalid_default_action",
                message=f"Invalid default_policy_action: {default_action}",
                meta={"default_policy_action": default_action},
            )

        allow_tools = _normalize_tool_list(payload.get("allow_tools"), field_name="allow_tools")
        deny_tools = _normalize_tool_list(payload.get("deny_tools"), field_name="deny_tools")
        require_approval_tools = _normalize_tool_list(
            payload.get("require_approval_tools"),
            field_name="require_approval_tools",
        )
        emergency_denylist = _normalize_tool_list(payload.get("emergency_denylist"), field_name="emergency_denylist")
        metadata = payload.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValidationError(
                code="agentos.policy.overlay.invalid_metadata",
                message="metadata must be a JSON object",
            )

        overlap = sorted(set(allow_tools).intersection(set(deny_tools)))
        if overlap:
            raise ValidationError(
                code="agentos.policy.overlay.conflicting_tools",
                message="Tools cannot be both allowed and denied in org overlay",
                meta={"tools": overlap},
            )

        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_org_policy_overlay (
                        organization_id, allow_tools, deny_tools, require_approval_tools,
                        emergency_denylist, default_policy_action, metadata,
                        updated_by_user_id, created_at, updated_at
                    ) VALUES (
                        :organization_id, CAST(:allow_tools AS JSONB), CAST(:deny_tools AS JSONB),
                        CAST(:require_approval_tools AS JSONB), CAST(:emergency_denylist AS JSONB),
                        :default_policy_action, CAST(:metadata AS JSONB),
                        :updated_by_user_id, :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id)
                    DO UPDATE SET
                        allow_tools = EXCLUDED.allow_tools,
                        deny_tools = EXCLUDED.deny_tools,
                        require_approval_tools = EXCLUDED.require_approval_tools,
                        emergency_denylist = EXCLUDED.emergency_denylist,
                        default_policy_action = EXCLUDED.default_policy_action,
                        metadata = EXCLUDED.metadata,
                        updated_by_user_id = EXCLUDED.updated_by_user_id,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "organization_id": organization_id,
                    "allow_tools": json_dumps_canonical(allow_tools),
                    "deny_tools": json_dumps_canonical(deny_tools),
                    "require_approval_tools": json_dumps_canonical(require_approval_tools),
                    "emergency_denylist": json_dumps_canonical(emergency_denylist),
                    "default_policy_action": default_action,
                    "metadata": json_dumps_canonical(metadata),
                    "updated_by_user_id": updated_by_user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        return await self.get_overlay(organization_id=organization_id)
