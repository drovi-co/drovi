from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.kernel.errors import ValidationError
from src.plugins.contracts import ExtensionTypeSpec, UIOTypeSpec


class LegalMatterPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matter_code: str | None = Field(default=None, max_length=128)
    client_name: str = Field(..., min_length=1, max_length=256)
    practice_area: str | None = Field(default=None, max_length=128)
    lead_counsel: str | None = Field(default=None, max_length=256)
    status: str = Field(default="open", min_length=1, max_length=64)
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    risk_score: float | None = Field(default=None, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class LegalAdvicePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matter_uio_id: str | None = Field(default=None, max_length=128)
    advice_text: str = Field(..., min_length=3)
    jurisdiction: str | None = Field(default=None, max_length=128)
    author_name: str | None = Field(default=None, max_length=256)
    supersedes_uio_id: str | None = Field(default=None, max_length=128)
    effective_at: datetime | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class LegalPlugin:
    plugin_id = "legal"

    def uio_types(self) -> list[UIOTypeSpec]:
        return [
            UIOTypeSpec(
                type="legal.matter",
                title="Matter",
                description="Legal matter/case timeline spine",
                high_stakes=True,
            ),
            UIOTypeSpec(
                type="legal.advice",
                title="Advice",
                description="Evidence-backed legal advice",
                high_stakes=True,
            ),
        ]

    def extension_types(self) -> list[ExtensionTypeSpec]:
        return [
            ExtensionTypeSpec(
                type="legal.matter",
                schema_version="1.0",
                typed_table="legal_matter",
                description="Canonical matter payload",
            ),
            ExtensionTypeSpec(
                type="legal.advice",
                schema_version="1.0",
                typed_table="legal_advice",
                description="Canonical advice payload",
            ),
        ]

    def validate_extension_payload(
        self,
        *,
        type_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            if type_name == "legal.matter":
                return LegalMatterPayload.model_validate(payload).model_dump(
                    mode="json",
                    exclude_none=True,
                )
            if type_name == "legal.advice":
                return LegalAdvicePayload.model_validate(payload).model_dump(
                    mode="json",
                    exclude_none=True,
                )
        except Exception as exc:  # pragma: no cover - exercised in tests
            raise ValidationError(
                code="extension.payload_invalid",
                message=f"Invalid payload for {type_name}",
                meta={"plugin": self.plugin_id, "error": str(exc)},
            ) from exc

        raise ValidationError(
            code="extension.type_unsupported",
            message=f"Unsupported legal extension type: {type_name}",
            meta={"plugin": self.plugin_id},
        )

    async def upsert_typed_extension(
        self,
        *,
        session: AsyncSession,
        organization_id: str,
        uio_id: str,
        type_name: str,
        payload: dict[str, Any],
    ) -> None:
        if type_name == "legal.matter":
            await session.execute(
                text(
                    """
                    INSERT INTO legal_matter (
                      uio_id, organization_id, matter_code, client_name, practice_area,
                      lead_counsel, status, opened_at, closed_at, risk_score, metadata, updated_at
                    ) VALUES (
                      :uio_id, :organization_id, :matter_code, :client_name, :practice_area,
                      :lead_counsel, :status, :opened_at, :closed_at, :risk_score, CAST(:metadata AS jsonb), NOW()
                    )
                    ON CONFLICT (uio_id) DO UPDATE SET
                      matter_code = EXCLUDED.matter_code,
                      client_name = EXCLUDED.client_name,
                      practice_area = EXCLUDED.practice_area,
                      lead_counsel = EXCLUDED.lead_counsel,
                      status = EXCLUDED.status,
                      opened_at = EXCLUDED.opened_at,
                      closed_at = EXCLUDED.closed_at,
                      risk_score = EXCLUDED.risk_score,
                      metadata = EXCLUDED.metadata,
                      updated_at = NOW()
                    """
                ),
                {
                    "uio_id": uio_id,
                    "organization_id": organization_id,
                    "matter_code": payload.get("matter_code"),
                    "client_name": payload.get("client_name"),
                    "practice_area": payload.get("practice_area"),
                    "lead_counsel": payload.get("lead_counsel"),
                    "status": payload.get("status", "open"),
                    "opened_at": payload.get("opened_at"),
                    "closed_at": payload.get("closed_at"),
                    "risk_score": payload.get("risk_score"),
                    "metadata": payload.get("metadata", {}),
                },
            )
            return

        if type_name == "legal.advice":
            await session.execute(
                text(
                    """
                    INSERT INTO legal_advice (
                      uio_id, organization_id, matter_uio_id, advice_text, jurisdiction,
                      author_name, supersedes_uio_id, effective_at, confidence, metadata, updated_at
                    ) VALUES (
                      :uio_id, :organization_id, :matter_uio_id, :advice_text, :jurisdiction,
                      :author_name, :supersedes_uio_id, :effective_at, :confidence, CAST(:metadata AS jsonb), NOW()
                    )
                    ON CONFLICT (uio_id) DO UPDATE SET
                      matter_uio_id = EXCLUDED.matter_uio_id,
                      advice_text = EXCLUDED.advice_text,
                      jurisdiction = EXCLUDED.jurisdiction,
                      author_name = EXCLUDED.author_name,
                      supersedes_uio_id = EXCLUDED.supersedes_uio_id,
                      effective_at = EXCLUDED.effective_at,
                      confidence = EXCLUDED.confidence,
                      metadata = EXCLUDED.metadata,
                      updated_at = NOW()
                    """
                ),
                {
                    "uio_id": uio_id,
                    "organization_id": organization_id,
                    "matter_uio_id": payload.get("matter_uio_id"),
                    "advice_text": payload.get("advice_text"),
                    "jurisdiction": payload.get("jurisdiction"),
                    "author_name": payload.get("author_name"),
                    "supersedes_uio_id": payload.get("supersedes_uio_id"),
                    "effective_at": payload.get("effective_at"),
                    "confidence": payload.get("confidence", 0.5),
                    "metadata": payload.get("metadata", {}),
                },
            )
            return

    def migration_revisions(self) -> list[str]:
        return ["050_vertical_extension_tables"]

    def storage_rules(self) -> dict[str, str]:
        return {
            "legal.matter": "legal_matter",
            "legal.advice": "legal_advice",
        }

    def capabilities(self) -> dict[str, bool]:
        return {
            "vertical.legal": True,
            "legal.advice_timeline": True,
            "legal.contradiction_detection": True,
            "legal.proof_first": True,
        }

    def ui_hints(self) -> dict[str, object]:
        return {
            "vertical": "legal",
            "modules": {
                "mod-ask": {"enabled": True},
                "mod-drive": {"enabled": True},
                "mod-evidence": {"enabled": True},
            },
            "type_labels": {
                "legal.matter": "Matter",
                "legal.advice": "Advice",
            },
        }

