from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.kernel.errors import NotFoundError, ValidationError
from src.plugins import get_plugin_registry


@dataclass(frozen=True)
class ExtensionUpsertResult:
    plugin_id: str
    type_name: str
    schema_version: str
    typed_table: str | None
    payload: dict[str, Any]


async def upsert_uio_extension(
    *,
    session: AsyncSession,
    organization_id: str,
    uio_id: str,
    type_name: str,
    payload: dict[str, Any],
    schema_version: str | None = None,
) -> ExtensionUpsertResult:
    """Validate + persist an extension payload and update typed tables.

    Storage policy:
    - Canonical truth spine remains `unified_intelligence_object`.
    - All extension payloads are stored in `uio_extension_payload`.
    - High-value extension types are projected into plugin-owned typed tables.
    """

    registry = get_plugin_registry()
    plugin, spec, normalized_payload = registry.validate_extension_payload(
        type_name=type_name,
        payload=payload,
    )

    expected_version = spec.schema_version
    if schema_version and schema_version != expected_version:
        raise ValidationError(
            code="extension.schema_version_invalid",
            message=(
                f"Schema version mismatch for {type_name}: expected "
                f"{expected_version}, got {schema_version}"
            ),
            meta={"type": type_name, "expected": expected_version, "actual": schema_version},
        )

    uio_row = await session.execute(
        text(
            """
            SELECT id
            FROM unified_intelligence_object
            WHERE id = :uio_id
              AND organization_id = :organization_id
            LIMIT 1
            """
        ),
        {"uio_id": uio_id, "organization_id": organization_id},
    )
    if not uio_row.fetchone():
        raise NotFoundError(
            code="extension.uio_not_found",
            message="UIO not found for extension upsert",
            meta={"uio_id": uio_id, "organization_id": organization_id},
        )

    await session.execute(
        text(
            """
            INSERT INTO uio_extension_payload (
              uio_id, organization_id, plugin_id, type, schema_version, payload, updated_at
            ) VALUES (
              :uio_id, :organization_id, :plugin_id, :type_name, :schema_version, CAST(:payload AS jsonb), NOW()
            )
            ON CONFLICT (uio_id, type) DO UPDATE SET
              plugin_id = EXCLUDED.plugin_id,
              schema_version = EXCLUDED.schema_version,
              payload = EXCLUDED.payload,
              updated_at = NOW()
            """
        ),
        {
            "uio_id": uio_id,
            "organization_id": organization_id,
            "plugin_id": plugin.plugin_id,
            "type_name": type_name,
            "schema_version": expected_version,
            "payload": normalized_payload,
        },
    )

    await plugin.upsert_typed_extension(
        session=session,
        organization_id=organization_id,
        uio_id=uio_id,
        type_name=type_name,
        payload=normalized_payload,
    )

    return ExtensionUpsertResult(
        plugin_id=plugin.plugin_id,
        type_name=type_name,
        schema_version=expected_version,
        typed_table=spec.typed_table,
        payload=normalized_payload,
    )

