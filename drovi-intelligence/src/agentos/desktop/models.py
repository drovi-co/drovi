from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


def _validate_capability(value: str) -> str:
    normalized = value.strip()
    if "." not in normalized:
        raise ValueError("capability must include a namespace prefix (for example fs.read)")
    prefix = normalized.split(".", 1)[0]
    if prefix not in {"fs", "app", "screen", "secret"}:
        raise ValueError("capability prefix must be one of: fs, app, screen, secret")
    return normalized


class DesktopActionRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=128)
    capability: str = Field(min_length=3, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    bridge_url: str | None = None
    bootstrap_secret: str | None = None
    token_capabilities: list[str] = Field(default_factory=list)
    token_ttl_seconds: int = Field(default=120, ge=5, le=600)
    subject: str | None = Field(default=None, max_length=128)
    timeout_seconds: float | None = Field(default=None, ge=1.0, le=60.0)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("capability")
    @classmethod
    def validate_capability(cls, value: str) -> str:
        return _validate_capability(value)

    @field_validator("token_capabilities")
    @classmethod
    def validate_token_capabilities(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in value:
            normalized.append(_validate_capability(str(item)))
        return sorted(set(normalized))


class DesktopActionResponse(BaseModel):
    organization_id: str
    bridge_url: str
    capability: str
    result: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = Field(default=0, ge=0)
    token_expires_in_seconds: int = Field(default=120, ge=5)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DesktopBridgeHealthRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=128)
    bridge_url: str | None = None


class DesktopBridgeHealthResponse(BaseModel):
    status: str = Field(default="unknown")
    bridge_url: str
    app_version: str | None = None
    remote_disabled: bool = False
    mtls: bool = False
    raw: dict[str, Any] = Field(default_factory=dict)


class DesktopBridgeControlRequest(BaseModel):
    organization_id: str = Field(min_length=1, max_length=128)
    bridge_url: str | None = None
    remote_disable_token: str | None = None
    reason: str | None = Field(default=None, max_length=200)


class DesktopBridgeControlResponse(BaseModel):
    ok: bool
    bridge_url: str
    remote_disabled: bool
    raw: dict[str, Any] = Field(default_factory=dict)
