from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.kernel.errors import ValidationError
from src.plugins.contracts import ExtensionTypeSpec, UIOTypeSpec


class AccountingFilingDeadlinePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_name: str = Field(..., min_length=1, max_length=256)
    filing_type: str = Field(..., min_length=1, max_length=128)
    due_at: datetime
    jurisdiction: str | None = Field(default=None, max_length=128)
    period_label: str | None = Field(default=None, max_length=128)
    owner_name: str | None = Field(default=None, max_length=256)
    status: str = Field(default="pending", min_length=1, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AccountingPlugin:
    plugin_id = "accounting"

    def uio_types(self) -> list[UIOTypeSpec]:
        return [
            UIOTypeSpec(
                type="accounting.filing_deadline",
                title="Filing Deadline",
                description="Regulatory/filing deadline with ownership and SLA context",
                high_stakes=True,
            )
        ]

    def extension_types(self) -> list[ExtensionTypeSpec]:
        return [
            ExtensionTypeSpec(
                type="accounting.filing_deadline",
                schema_version="1.0",
                typed_table="accounting_filing_deadline",
                description="Canonical filing deadline payload",
            )
        ]

    def validate_extension_payload(
        self,
        *,
        type_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        if type_name != "accounting.filing_deadline":
            raise ValidationError(
                code="extension.type_unsupported",
                message=f"Unsupported accounting extension type: {type_name}",
                meta={"plugin": self.plugin_id},
            )
        try:
            model = AccountingFilingDeadlinePayload.model_validate(payload)
        except Exception as exc:  # pragma: no cover - exercised in tests
            raise ValidationError(
                code="extension.payload_invalid",
                message=f"Invalid payload for {type_name}",
                meta={"plugin": self.plugin_id, "error": str(exc)},
            ) from exc
        return model.model_dump(mode="json", exclude_none=True)

    async def upsert_typed_extension(
        self,
        *,
        session: AsyncSession,
        organization_id: str,
        uio_id: str,
        type_name: str,
        payload: dict[str, Any],
    ) -> None:
        if type_name != "accounting.filing_deadline":
            return

        await session.execute(
            text(
                """
                INSERT INTO accounting_filing_deadline (
                  uio_id, organization_id, client_name, filing_type, due_at, jurisdiction,
                  period_label, owner_name, status, metadata, updated_at
                ) VALUES (
                  :uio_id, :organization_id, :client_name, :filing_type, :due_at, :jurisdiction,
                  :period_label, :owner_name, :status, CAST(:metadata AS jsonb), NOW()
                )
                ON CONFLICT (uio_id) DO UPDATE SET
                  client_name = EXCLUDED.client_name,
                  filing_type = EXCLUDED.filing_type,
                  due_at = EXCLUDED.due_at,
                  jurisdiction = EXCLUDED.jurisdiction,
                  period_label = EXCLUDED.period_label,
                  owner_name = EXCLUDED.owner_name,
                  status = EXCLUDED.status,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
                """
            ),
            {
                "uio_id": uio_id,
                "organization_id": organization_id,
                "client_name": payload.get("client_name"),
                "filing_type": payload.get("filing_type"),
                "due_at": payload.get("due_at"),
                "jurisdiction": payload.get("jurisdiction"),
                "period_label": payload.get("period_label"),
                "owner_name": payload.get("owner_name"),
                "status": payload.get("status", "pending"),
                "metadata": payload.get("metadata", {}),
            },
        )

    def migration_revisions(self) -> list[str]:
        return ["050_vertical_extension_tables"]

    def storage_rules(self) -> dict[str, str]:
        return {"accounting.filing_deadline": "accounting_filing_deadline"}

    def capabilities(self) -> dict[str, bool]:
        return {
            "vertical.accounting": True,
            "accounting.deadline_tracker": True,
        }

    def ui_hints(self) -> dict[str, object]:
        return {
            "vertical": "accounting",
            "modules": {
                "mod-drive": {"enabled": True},
                "mod-sources": {"enabled": True},
                "mod-teams": {"enabled": True},
            },
            "type_labels": {"accounting.filing_deadline": "Filing Deadline"},
        }

