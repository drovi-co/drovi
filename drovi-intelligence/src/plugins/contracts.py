from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, Field


class UIOTypeSpec(BaseModel):
    """A registered UIO type.

    The `type` string is the canonical DB value (e.g. "commitment" or "legal.advice").
    """

    type: str = Field(..., min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=256)
    description: str | None = Field(default=None, max_length=2048)
    high_stakes: bool = False


class PluginManifest(BaseModel):
    """Summary of enabled plugins and their exposed capabilities."""

    plugins: list[str]
    uio_types: list[UIOTypeSpec]
    capabilities: dict[str, bool] = Field(default_factory=dict)
    ui_hints: dict[str, Any] = Field(default_factory=dict)


class VerticalPlugin(Protocol):
    plugin_id: str

    def uio_types(self) -> list[UIOTypeSpec]: ...

    def capabilities(self) -> dict[str, bool]: ...

    def ui_hints(self) -> dict[str, Any]: ...

