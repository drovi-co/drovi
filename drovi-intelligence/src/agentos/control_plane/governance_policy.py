from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import ValidationError
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import GovernancePolicyRecord



def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)



def _normalize_regions(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(
            code="agentos.governance.invalid_regions",
            message="allowed_regions must be a list",
        )
    normalized: list[str] = []
    for item in value:
        region = str(item or "").strip().lower()
        if region:
            normalized.append(region)
    return sorted(set(normalized))



class GovernancePolicyService:
    """Per-org governance hooks: residency, retention, kill switch, delegated authority enforcement."""

    async def get_policy(self, *, organization_id: str) -> GovernancePolicyRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT organization_id, residency_region, allowed_regions,
                           data_retention_days, evidence_retention_days,
                           require_residency_enforcement, enforce_delegated_authority,
                           kill_switch_enabled, metadata, updated_by_user_id,
                           created_at, updated_at
                    FROM agent_org_governance_policy
                    WHERE organization_id = :organization_id
                    """
                ),
                {"organization_id": organization_id},
            )
            row = result.fetchone()
        if row is None:
            return GovernancePolicyRecord(organization_id=organization_id)
        return GovernancePolicyRecord.model_validate(_row_to_dict(row))

    async def upsert_policy(
        self,
        *,
        organization_id: str,
        policy: GovernancePolicyRecord | dict[str, Any],
        updated_by_user_id: str | None,
    ) -> GovernancePolicyRecord:
        payload = policy.model_dump(mode="json") if isinstance(policy, GovernancePolicyRecord) else dict(policy)
        payload["organization_id"] = organization_id

        residency_region = str(payload.get("residency_region") or "global").strip().lower() or "global"
        allowed_regions = _normalize_regions(payload.get("allowed_regions"))
        if allowed_regions and residency_region not in {"", "global"} and residency_region not in set(allowed_regions):
            allowed_regions = sorted(set(allowed_regions).union({residency_region}))

        data_retention_days = int(payload.get("data_retention_days") or 365)
        evidence_retention_days = int(payload.get("evidence_retention_days") or 3650)
        if data_retention_days <= 0:
            raise ValidationError(
                code="agentos.governance.invalid_data_retention",
                message="data_retention_days must be > 0",
            )
        if evidence_retention_days <= 0:
            raise ValidationError(
                code="agentos.governance.invalid_evidence_retention",
                message="evidence_retention_days must be > 0",
            )

        require_residency_enforcement = bool(payload.get("require_residency_enforcement", True))
        enforce_delegated_authority = bool(payload.get("enforce_delegated_authority", False))
        kill_switch_enabled = bool(payload.get("kill_switch_enabled", False))
        metadata = payload.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValidationError(
                code="agentos.governance.invalid_metadata",
                message="metadata must be an object",
            )

        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_org_governance_policy (
                        organization_id, residency_region, allowed_regions,
                        data_retention_days, evidence_retention_days,
                        require_residency_enforcement, enforce_delegated_authority,
                        kill_switch_enabled, metadata, updated_by_user_id,
                        created_at, updated_at
                    ) VALUES (
                        :organization_id, :residency_region, CAST(:allowed_regions AS JSONB),
                        :data_retention_days, :evidence_retention_days,
                        :require_residency_enforcement, :enforce_delegated_authority,
                        :kill_switch_enabled, CAST(:metadata AS JSONB), :updated_by_user_id,
                        :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id)
                    DO UPDATE SET
                        residency_region = EXCLUDED.residency_region,
                        allowed_regions = EXCLUDED.allowed_regions,
                        data_retention_days = EXCLUDED.data_retention_days,
                        evidence_retention_days = EXCLUDED.evidence_retention_days,
                        require_residency_enforcement = EXCLUDED.require_residency_enforcement,
                        enforce_delegated_authority = EXCLUDED.enforce_delegated_authority,
                        kill_switch_enabled = EXCLUDED.kill_switch_enabled,
                        metadata = EXCLUDED.metadata,
                        updated_by_user_id = EXCLUDED.updated_by_user_id,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "organization_id": organization_id,
                    "residency_region": residency_region,
                    "allowed_regions": json_dumps_canonical(allowed_regions),
                    "data_retention_days": data_retention_days,
                    "evidence_retention_days": evidence_retention_days,
                    "require_residency_enforcement": require_residency_enforcement,
                    "enforce_delegated_authority": enforce_delegated_authority,
                    "kill_switch_enabled": kill_switch_enabled,
                    "metadata": json_dumps_canonical(metadata),
                    "updated_by_user_id": updated_by_user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        return await self.get_policy(organization_id=organization_id)
