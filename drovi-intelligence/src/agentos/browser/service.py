from __future__ import annotations

from typing import Any

import structlog

from src.agentos.control_plane.audit import emit_control_plane_audit_event
from src.config import get_settings
from src.kernel.errors import ValidationError
from src.monitoring import get_metrics

from .models import (
    BrowserActionRequest,
    BrowserActionResponse,
    BrowserArtifactRecord,
    BrowserCreateSessionRequest,
    BrowserProviderActionRequest,
    BrowserProviderType,
    BrowserSecretRecord,
    BrowserSecretResolved,
    BrowserSessionRecord,
)
from .persistence import BrowserPersistence
from .policy import BrowserSafetyPolicy
from .registry import BrowserProviderRegistry
from .secrets import BrowserSecretManager

logger = structlog.get_logger()


class BrowserService:
    def __init__(
        self,
        *,
        persistence: BrowserPersistence | None = None,
        providers: BrowserProviderRegistry | None = None,
        safety_policy: BrowserSafetyPolicy | None = None,
        secrets: BrowserSecretManager | None = None,
    ) -> None:
        self._persistence = persistence or BrowserPersistence()
        self._providers = providers or BrowserProviderRegistry()
        self._safety = safety_policy or BrowserSafetyPolicy()
        self._secrets = secrets or BrowserSecretManager()

    async def create_session(
        self,
        *,
        request: BrowserCreateSessionRequest,
        actor_id: str | None,
    ) -> BrowserSessionRecord:
        settings = get_settings()
        provider: BrowserProviderType = request.provider or settings.browser_default_provider
        fallback = [item for item in request.fallback_providers if item != provider]
        session = await self._persistence.create_session(
            organization_id=request.organization_id,
            provider=provider,
            deployment_id=request.deployment_id,
            run_id=request.run_id,
            status="active",
            current_url=request.initial_url,
            state={"fallback_providers": fallback},
            artifacts={},
            metadata=request.metadata,
        )
        credential_meta = await self._resolve_provider_credentials(
            organization_id=request.organization_id,
            provider=provider,
        )
        provider_session = await self._providers.create_session(
            provider=provider,
            organization_id=request.organization_id,
            session_id=session.id,
            initial_url=request.initial_url,
            metadata={**request.metadata, **credential_meta},
            fallback_providers=fallback,
        )
        patched = await self._persistence.touch_session(
            organization_id=request.organization_id,
            session_id=session.id,
            status="active",
            current_url=provider_session.current_url or request.initial_url,
            state={
                "provider_session_id": provider_session.provider_session_id,
                "fallback_providers": fallback,
            },
            metadata_patch={
                "provider_mode": provider_session.metadata.get("mode"),
                "provider_metadata": provider_session.metadata,
            },
        )
        get_metrics().track_browser_session(provider=provider, event="created")
        await emit_control_plane_audit_event(
            organization_id=request.organization_id,
            action="agentos.browser.session.created",
            actor_id=actor_id,
            resource_type="agent_browser_session",
            resource_id=patched.id,
            metadata={"provider": provider, "fallback_providers": fallback},
        )
        return patched

    async def list_sessions(
        self,
        *,
        organization_id: str,
        status: str | None,
        deployment_id: str | None,
        run_id: str | None,
        limit: int,
        offset: int,
    ) -> list[BrowserSessionRecord]:
        return await self._persistence.list_sessions(
            organization_id=organization_id,
            status=status,  # type: ignore[arg-type]
            deployment_id=deployment_id,
            run_id=run_id,
            limit=limit,
            offset=offset,
        )

    async def get_session(self, *, organization_id: str, session_id: str) -> BrowserSessionRecord:
        return await self._persistence.get_session(organization_id=organization_id, session_id=session_id)

    async def close_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        reason: str | None,
        actor_id: str | None,
    ) -> BrowserSessionRecord:
        session = await self._persistence.get_session(organization_id=organization_id, session_id=session_id)
        provider_session_id = str((session.state or {}).get("provider_session_id") or "")
        if provider_session_id:
            credential_meta = await self._resolve_provider_credentials(
                organization_id=organization_id,
                provider=session.provider,
            )
            await self._providers.close_session(
                provider=session.provider,
                organization_id=organization_id,
                provider_session_id=provider_session_id,
                metadata=credential_meta,
            )
        closed = await self._persistence.close_session(organization_id=organization_id, session_id=session_id)
        get_metrics().track_browser_session(provider=session.provider, event="closed")
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.browser.session.closed",
            actor_id=actor_id,
            resource_type="agent_browser_session",
            resource_id=session_id,
            metadata={"provider": session.provider, "reason": reason},
        )
        return closed

    async def execute_action(
        self,
        *,
        organization_id: str,
        session_id: str,
        request: BrowserActionRequest,
        actor_id: str | None,
    ) -> BrowserActionResponse:
        if request.organization_id != organization_id:
            raise ValidationError(
                code="agentos.browser.organization_mismatch",
                message="request.organization_id does not match route organization",
            )
        session = await self._persistence.get_session(organization_id=organization_id, session_id=session_id)
        if session.status != "active":
            raise ValidationError(
                code="agentos.browser.session_not_active",
                message="Browser session is not active",
                status_code=409,
                meta={"session_id": session_id, "status": session.status},
            )
        self._safety.enforce(
            request=request,
            current_url=session.current_url,
            session_metadata=session.metadata or {},
        )
        provider_session_id = str((session.state or {}).get("provider_session_id") or "")
        if not provider_session_id:
            raise ValidationError(
                code="agentos.browser.provider_session_missing",
                message="Provider session id is missing from browser session state",
                status_code=409,
                meta={"session_id": session_id},
            )

        fallback = (session.state or {}).get("fallback_providers") or []
        fallback_list = [item for item in fallback if isinstance(item, str)]
        provider_metadata = await self._resolve_provider_credentials(
            organization_id=organization_id,
            provider=session.provider,
        )
        provider_request = BrowserProviderActionRequest(**request.model_dump(mode="json"))
        metric_status = "ok"
        try:
            selected_provider, result = await self._providers.execute_action(
                provider=session.provider,
                organization_id=organization_id,
                provider_session_id=provider_session_id,
                request=provider_request,
                metadata={**(session.metadata or {}), **provider_metadata},
                fallback_providers=fallback_list,  # type: ignore[arg-type]
            )
            action_log = await self._persistence.create_action_log(
                organization_id=organization_id,
                session_id=session_id,
                action_type=request.action,
                status=result.status,
                request_payload=request.model_dump(mode="json"),
                response_payload=result.model_dump(mode="json"),
                error_message=result.error_message,
            )
            artifact_map = await self._store_artifacts(
                organization_id=organization_id,
                session_id=session_id,
                action_log_id=action_log.id,
                artifacts=result.artifacts,
            )
            patched = await self._persistence.touch_session(
                organization_id=organization_id,
                session_id=session_id,
                status="active",
                current_url=result.current_url or session.current_url,
                state={
                    **(session.state or {}),
                    "provider_session_id": provider_session_id,
                    "fallback_providers": fallback_list,
                },
                artifacts={
                    **(session.artifacts or {}),
                    "last_action": request.action,
                    "last_action_log_id": action_log.id,
                    "last_artifacts": artifact_map,
                },
                metadata_patch={"last_provider_used": selected_provider},
            )
            get_metrics().track_browser_action(
                provider=session.provider,
                action=request.action,
                status=result.status,
                fallback=(selected_provider != session.provider),
            )
            if selected_provider != session.provider:
                get_metrics().track_browser_fallback(
                    from_provider=session.provider,
                    to_provider=selected_provider,
                    reason="provider_error",
                )
            await emit_control_plane_audit_event(
                organization_id=organization_id,
                action="agentos.browser.action.executed",
                actor_id=actor_id,
                resource_type="agent_browser_action_log",
                resource_id=action_log.id,
                metadata={
                    "session_id": session_id,
                    "action": request.action,
                    "provider": session.provider,
                    "selected_provider": selected_provider,
                    "status": result.status,
                },
            )
            return BrowserActionResponse(session=patched, action_log=action_log)
        except Exception as exc:
            metric_status = "failed"
            error_message = str(exc)
            try:
                await self._persistence.create_action_log(
                    organization_id=organization_id,
                    session_id=session_id,
                    action_type=request.action,
                    status="failed",
                    request_payload=request.model_dump(mode="json"),
                    response_payload={},
                    error_message=error_message,
                )
            except Exception:
                logger.warning("Failed to persist browser action failure log", session_id=session_id)
            raise
        finally:
            get_metrics().track_browser_action(
                provider=session.provider,
                action=request.action,
                status=metric_status,
                fallback=False,
            )

    async def list_action_logs(
        self,
        *,
        organization_id: str,
        session_id: str,
        limit: int,
        offset: int,
    ) -> list[Any]:
        return await self._persistence.list_action_logs(
            organization_id=organization_id,
            session_id=session_id,
            limit=limit,
            offset=offset,
        )

    async def list_artifacts(
        self,
        *,
        organization_id: str,
        session_id: str,
        limit: int,
        offset: int,
    ) -> list[BrowserArtifactRecord]:
        return await self._persistence.list_artifacts(
            organization_id=organization_id,
            session_id=session_id,
            limit=limit,
            offset=offset,
        )

    async def upsert_secret(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        secret_name: str,
        secret_value: str,
        metadata: dict[str, Any],
        actor_id: str | None,
    ) -> BrowserSecretRecord:
        normalized_secret_name = secret_name.strip().lower()
        if normalized_secret_name not in {"api_key", "base_url"}:
            raise ValidationError(
                code="agentos.browser.secret_name_invalid",
                message="Unsupported browser secret name. Allowed: api_key, base_url",
                meta={"secret_name": normalized_secret_name},
            )
        encrypted = self._secrets.encrypt(secret_value)
        preview = self._secrets.preview(secret_value)
        record = await self._persistence.upsert_secret(
            organization_id=organization_id,
            provider=provider,
            secret_name=normalized_secret_name,
            secret_ciphertext=encrypted,
            secret_preview=preview,
            metadata=metadata,
        )
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.browser.secret.upserted",
            actor_id=actor_id,
            resource_type="agent_browser_provider_secret",
            resource_id=f"{provider}:{normalized_secret_name}",
            metadata={"provider": provider, "secret_name": normalized_secret_name},
        )
        return record

    async def list_secrets(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType | None,
    ) -> list[BrowserSecretRecord]:
        return await self._persistence.list_secrets(organization_id=organization_id, provider=provider)

    async def resolve_secret(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        secret_name: str,
    ) -> BrowserSecretResolved | None:
        try:
            encrypted = await self._persistence.get_secret_ciphertext(
                organization_id=organization_id,
                provider=provider,
                secret_name=secret_name,
            )
            value = self._secrets.decrypt(encrypted)
            return BrowserSecretResolved(
                organization_id=organization_id,
                provider=provider,
                secret_name=secret_name,
                secret_value=value,
            )
        except Exception:
            return None

    async def _resolve_provider_credentials(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
    ) -> dict[str, Any]:
        resolved: dict[str, Any] = {}
        for secret_name in ("api_key", "base_url"):
            secret = await self.resolve_secret(
                organization_id=organization_id,
                provider=provider,
                secret_name=secret_name,
            )
            if secret is not None:
                resolved_key = (
                    f"{provider}_api_key" if secret_name == "api_key" else f"{provider}_base_url"
                )
                resolved[resolved_key] = secret.secret_value
                if provider == "managed":
                    resolved[f"managed_{secret_name}"] = secret.secret_value
                if provider == "parallel":
                    resolved[f"parallel_{secret_name}"] = secret.secret_value
        return resolved

    async def _store_artifacts(
        self,
        *,
        organization_id: str,
        session_id: str,
        action_log_id: str,
        artifacts: dict[str, Any],
    ) -> dict[str, str]:
        stored: dict[str, str] = {}
        for key, value in artifacts.items():
            if not isinstance(value, str):
                continue
            artifact_type = key if key in {"trace", "har", "screenshot", "dom_snapshot", "download", "upload"} else "trace"
            record = await self._persistence.create_artifact(
                organization_id=organization_id,
                session_id=session_id,
                action_log_id=action_log_id,
                artifact_type=artifact_type,  # type: ignore[arg-type]
                storage_backend="file" if value.startswith("/") else "inline",
                storage_uri=value,
                metadata={"provider_artifact_key": key},
            )
            stored[key] = record.id
        return stored
