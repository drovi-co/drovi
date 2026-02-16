from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class UIOTypeSpec(BaseModel):
    """A registered UIO type.

    The `type` string is the canonical DB value (e.g. "commitment" or "legal.advice").
    """

    type: str = Field(..., min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=256)
    description: str | None = Field(default=None, max_length=2048)
    high_stakes: bool = False


class ExtensionTypeSpec(BaseModel):
    """Schema contract for plugin-managed extension payloads."""

    type: str = Field(..., min_length=1, max_length=128)
    schema_version: str = Field(default="1.0", min_length=1, max_length=32)
    typed_table: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2048)


class StorageRuleSet(BaseModel):
    """How vertical extensions are persisted."""

    canonical_spine_table: str = "unified_intelligence_object"
    extension_payload_table: str = "uio_extension_payload"
    typed_tables: dict[str, str] = Field(default_factory=dict)
    notes: str | None = None


class PluginManifest(BaseModel):
    """Summary of enabled plugins and their exposed capabilities."""

    plugins: list[str]
    uio_types: list[UIOTypeSpec]
    extension_types: list[ExtensionTypeSpec] = Field(default_factory=list)
    capabilities: dict[str, bool] = Field(default_factory=dict)
    ui_hints: dict[str, Any] = Field(default_factory=dict)
    storage_rules: StorageRuleSet = Field(default_factory=StorageRuleSet)


class VerticalPlugin(Protocol):
    plugin_id: str

    def uio_types(self) -> list[UIOTypeSpec]: ...

    def extension_types(self) -> list[ExtensionTypeSpec]: ...

    def validate_extension_payload(
        self,
        *,
        type_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]: ...

    async def upsert_typed_extension(
        self,
        *,
        session: AsyncSession,
        organization_id: str,
        uio_id: str,
        type_name: str,
        payload: dict[str, Any],
    ) -> None: ...

    def migration_revisions(self) -> list[str]: ...

    def storage_rules(self) -> dict[str, str]: ...

    def capabilities(self) -> dict[str, bool]: ...

    def ui_hints(self) -> dict[str, Any]: ...
