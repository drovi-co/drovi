from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.plugins import get_plugin_registry
from src.plugins.contracts import ExtensionTypeSpec, StorageRuleSet
from src.plugins.extensions import upsert_uio_extension

router = APIRouter(prefix="/extensions", tags=["Vertical Extensions"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")


class ExtensionCatalogResponse(BaseModel):
    plugins: list[str]
    extension_types: list[ExtensionTypeSpec]
    storage_rules: StorageRuleSet


class UpsertExtensionRequest(BaseModel):
    type: str = Field(..., min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    schema_version: str | None = Field(default=None, max_length=32)


class UpsertExtensionResponse(BaseModel):
    success: bool = True
    uio_id: str
    type: str
    plugin_id: str
    schema_version: str
    typed_table: str | None = None


@router.get("/catalog", response_model=ExtensionCatalogResponse)
async def extension_catalog(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> ExtensionCatalogResponse:
    _ = ctx
    registry = get_plugin_registry()
    manifest = registry.manifest()
    return ExtensionCatalogResponse(
        plugins=manifest.plugins,
        extension_types=manifest.extension_types,
        storage_rules=manifest.storage_rules,
    )


@router.post("/{uio_id}", response_model=UpsertExtensionResponse)
async def upsert_extension(
    uio_id: str,
    organization_id: str,
    request: UpsertExtensionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> UpsertExtensionResponse:
    _validate_org_id(ctx, organization_id)
    async with get_db_session() as session:
        result = await upsert_uio_extension(
            session=session,
            organization_id=organization_id,
            uio_id=uio_id,
            type_name=request.type,
            payload=request.payload,
            schema_version=request.schema_version,
        )
        await session.commit()
    return UpsertExtensionResponse(
        uio_id=uio_id,
        type=result.type_name,
        plugin_id=result.plugin_id,
        schema_version=result.schema_version,
        typed_table=result.typed_table,
    )

