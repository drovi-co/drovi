from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import PolicyDecisionAction, ToolManifestRecord, ToolSideEffectTier

_VALID_SIDE_EFFECT_TIERS: set[ToolSideEffectTier] = {
    "read_only",
    "low_risk_write",
    "high_risk_write",
    "external_commit",
}
_VALID_POLICY_ACTIONS: set[PolicyDecisionAction] = {"allow", "deny", "require_approval"}


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


def _validate_json_schema(schema: dict[str, Any], *, field_name: str) -> None:
    if not isinstance(schema, dict):
        raise ValidationError(
            code="agentos.tools.invalid_schema",
            message=f"{field_name} must be a JSON object",
            meta={"field": field_name},
        )
    schema_type = schema.get("type")
    if schema_type is not None and not isinstance(schema_type, str):
        raise ValidationError(
            code="agentos.tools.invalid_schema",
            message=f"{field_name}.type must be a string when provided",
            meta={"field": field_name},
        )


def _validate_manifest_payload(payload: dict[str, Any]) -> None:
    side_effect_tier = payload.get("side_effect_tier")
    if side_effect_tier not in _VALID_SIDE_EFFECT_TIERS:
        raise ValidationError(
            code="agentos.tools.invalid_side_effect_tier",
            message=f"Invalid side_effect_tier: {side_effect_tier}",
            meta={"side_effect_tier": side_effect_tier},
        )

    default_policy_action = payload.get("default_policy_action") or "allow"
    if default_policy_action not in _VALID_POLICY_ACTIONS:
        raise ValidationError(
            code="agentos.tools.invalid_default_action",
            message=f"Invalid default_policy_action: {default_policy_action}",
            meta={"default_policy_action": default_policy_action},
        )

    _validate_json_schema(payload.get("input_schema") or {}, field_name="input_schema")
    _validate_json_schema(payload.get("output_schema") or {}, field_name="output_schema")


class ToolRegistryService:
    """Typed registry for tool manifests used by policy/runtime."""

    async def list_manifests(
        self,
        *,
        organization_id: str,
        include_disabled: bool = False,
    ) -> list[ToolManifestRecord]:
        query = """
            SELECT id, organization_id, tool_id, name, description, side_effect_tier,
                   default_policy_action, requires_evidence, high_stakes,
                   input_schema, output_schema, metadata, is_enabled, created_at, updated_at
            FROM agent_tool_manifest
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {"organization_id": organization_id}
        if not include_disabled:
            query += " AND is_enabled = TRUE"
        query += " ORDER BY tool_id ASC"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()

        return [ToolManifestRecord.model_validate(_row_to_dict(row)) for row in rows]

    async def get_manifest(self, *, organization_id: str, tool_id: str) -> ToolManifestRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, tool_id, name, description, side_effect_tier,
                           default_policy_action, requires_evidence, high_stakes,
                           input_schema, output_schema, metadata, is_enabled, created_at, updated_at
                    FROM agent_tool_manifest
                    WHERE organization_id = :organization_id
                      AND tool_id = :tool_id
                    """
                ),
                {"organization_id": organization_id, "tool_id": tool_id},
            )
            row = result.fetchone()

        if row is None:
            raise NotFoundError(
                code="agentos.tools.not_found",
                message="Tool manifest not found",
                meta={"organization_id": organization_id, "tool_id": tool_id},
            )
        return ToolManifestRecord.model_validate(_row_to_dict(row))

    async def upsert_manifest(
        self,
        *,
        organization_id: str,
        manifest: ToolManifestRecord | dict[str, Any],
    ) -> ToolManifestRecord:
        payload = manifest.model_dump(mode="json") if isinstance(manifest, ToolManifestRecord) else dict(manifest)
        payload["organization_id"] = organization_id
        payload["tool_id"] = str(payload.get("tool_id") or "").strip()

        if not payload["tool_id"]:
            raise ValidationError(
                code="agentos.tools.tool_id_required",
                message="tool_id is required",
            )
        payload["name"] = str(payload.get("name") or payload["tool_id"]).strip() or payload["tool_id"]
        payload["default_policy_action"] = payload.get("default_policy_action") or "allow"
        payload["input_schema"] = payload.get("input_schema") or {}
        payload["output_schema"] = payload.get("output_schema") or {}
        payload["metadata"] = payload.get("metadata") or {}
        payload["is_enabled"] = bool(payload.get("is_enabled", True))
        payload["requires_evidence"] = bool(payload.get("requires_evidence", False))
        payload["high_stakes"] = bool(payload.get("high_stakes", False))

        _validate_manifest_payload(payload)
        now = utc_now()

        async with get_db_session() as session:
            existing = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_tool_manifest
                    WHERE organization_id = :organization_id
                      AND tool_id = :tool_id
                    """
                ),
                {"organization_id": organization_id, "tool_id": payload["tool_id"]},
            )
            existing_row = existing.fetchone()
            manifest_id = str(existing_row.id) if existing_row else new_prefixed_id("agtool")

            await session.execute(
                text(
                    """
                    INSERT INTO agent_tool_manifest (
                        id, organization_id, tool_id, name, description, side_effect_tier,
                        default_policy_action, requires_evidence, high_stakes,
                        input_schema, output_schema, metadata, is_enabled, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :tool_id, :name, :description, :side_effect_tier,
                        :default_policy_action, :requires_evidence, :high_stakes,
                        CAST(:input_schema AS JSONB), CAST(:output_schema AS JSONB), CAST(:metadata AS JSONB),
                        :is_enabled, :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id, tool_id)
                    DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        side_effect_tier = EXCLUDED.side_effect_tier,
                        default_policy_action = EXCLUDED.default_policy_action,
                        requires_evidence = EXCLUDED.requires_evidence,
                        high_stakes = EXCLUDED.high_stakes,
                        input_schema = EXCLUDED.input_schema,
                        output_schema = EXCLUDED.output_schema,
                        metadata = EXCLUDED.metadata,
                        is_enabled = EXCLUDED.is_enabled,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": manifest_id,
                    "organization_id": organization_id,
                    "tool_id": payload["tool_id"],
                    "name": payload["name"],
                    "description": payload.get("description"),
                    "side_effect_tier": payload["side_effect_tier"],
                    "default_policy_action": payload["default_policy_action"],
                    "requires_evidence": payload["requires_evidence"],
                    "high_stakes": payload["high_stakes"],
                    "input_schema": json_dumps_canonical(payload["input_schema"]),
                    "output_schema": json_dumps_canonical(payload["output_schema"]),
                    "metadata": json_dumps_canonical(payload["metadata"]),
                    "is_enabled": payload["is_enabled"],
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        return await self.get_manifest(organization_id=organization_id, tool_id=payload["tool_id"])

    async def set_enabled(
        self,
        *,
        organization_id: str,
        tool_id: str,
        is_enabled: bool,
    ) -> ToolManifestRecord:
        now = utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE agent_tool_manifest
                    SET is_enabled = :is_enabled, updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND tool_id = :tool_id
                    RETURNING id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "tool_id": tool_id,
                    "is_enabled": is_enabled,
                    "updated_at": now,
                },
            )
            row = result.fetchone()
            if row is None:
                raise NotFoundError(
                    code="agentos.tools.not_found",
                    message="Tool manifest not found",
                    meta={"organization_id": organization_id, "tool_id": tool_id},
                )
            await session.commit()
        return await self.get_manifest(organization_id=organization_id, tool_id=tool_id)
