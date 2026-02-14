from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


BrowserProviderType = Literal["local", "managed", "parallel"]
BrowserSessionStatus = Literal["active", "closed", "failed"]
BrowserActionType = Literal["navigate", "snapshot", "click", "type", "download", "upload"]
BrowserActionStatus = Literal["ok", "failed", "blocked", "fallback"]
BrowserArtifactType = Literal["trace", "har", "screenshot", "dom_snapshot", "download", "upload"]
BrowserArtifactStorage = Literal["inline", "file", "s3"]


class BrowserSessionRecord(BaseModel):
    id: str
    organization_id: str
    provider: BrowserProviderType
    deployment_id: str | None = None
    run_id: str | None = None
    status: BrowserSessionStatus
    current_url: str | None = None
    state: dict[str, Any] = Field(default_factory=dict)
    artifacts: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_active_at: datetime | None = None


class BrowserActionLogRecord(BaseModel):
    id: str
    session_id: str
    organization_id: str
    action_type: BrowserActionType
    status: BrowserActionStatus
    request_payload: dict[str, Any] = Field(default_factory=dict)
    response_payload: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    created_at: datetime | None = None


class BrowserArtifactRecord(BaseModel):
    id: str
    organization_id: str
    session_id: str
    action_log_id: str | None = None
    artifact_type: BrowserArtifactType
    storage_backend: BrowserArtifactStorage = "inline"
    storage_uri: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class BrowserSecretRecord(BaseModel):
    organization_id: str
    provider: BrowserProviderType
    secret_name: str
    secret_preview: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BrowserSecretResolved(BaseModel):
    organization_id: str
    provider: BrowserProviderType
    secret_name: str
    secret_value: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserCreateSessionRequest(BaseModel):
    organization_id: str
    provider: BrowserProviderType | None = None
    fallback_providers: list[BrowserProviderType] = Field(default_factory=list)
    deployment_id: str | None = None
    run_id: str | None = None
    initial_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserSessionResponse(BaseModel):
    session: BrowserSessionRecord


class BrowserActionRequest(BaseModel):
    organization_id: str
    action: BrowserActionType
    url: str | None = None
    selector: str | None = None
    text: str | None = None
    timeout_ms: int | None = None
    file_name: str | None = None
    content_base64: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserActionResponse(BaseModel):
    session: BrowserSessionRecord
    action_log: BrowserActionLogRecord


class BrowserProviderSession(BaseModel):
    provider_session_id: str
    provider: BrowserProviderType
    current_url: str | None = None
    artifacts: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserProviderActionResult(BaseModel):
    status: BrowserActionStatus = "ok"
    current_url: str | None = None
    artifacts: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    fallback_from: BrowserProviderType | None = None


class BrowserNavigateRequest(BaseModel):
    url: HttpUrl
    timeout_ms: int | None = None


class BrowserProviderActionRequest(BaseModel):
    action: BrowserActionType
    url: str | None = None
    selector: str | None = None
    text: str | None = None
    timeout_ms: int | None = None
    file_name: str | None = None
    content_base64: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrowserCloseSessionRequest(BaseModel):
    organization_id: str
    reason: str | None = None


class BrowserSecretUpsertRequest(BaseModel):
    organization_id: str
    secret_value: str = Field(min_length=1, max_length=4096)
    metadata: dict[str, Any] = Field(default_factory=dict)
