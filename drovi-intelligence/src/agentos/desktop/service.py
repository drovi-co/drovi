from __future__ import annotations

from time import perf_counter
from typing import Any
from urllib.parse import urlparse

import httpx

from src.agentos.control_plane.audit import emit_control_plane_audit_event
from src.config import get_settings
from src.kernel.errors import UpstreamError, ValidationError
from src.monitoring import get_metrics

from .models import (
    DesktopActionRequest,
    DesktopActionResponse,
    DesktopBridgeControlRequest,
    DesktopBridgeControlResponse,
    DesktopBridgeHealthRequest,
    DesktopBridgeHealthResponse,
)


class DesktopBridgeService:
    """Client for Drovi Desktop Companion local bridge APIs."""

    async def execute_action(
        self,
        *,
        request: DesktopActionRequest,
        actor_id: str | None,
    ) -> DesktopActionResponse:
        bridge_url = self._resolve_bridge_url(request.bridge_url)
        timeout_seconds = self._resolve_timeout(request.timeout_seconds)
        bootstrap_secret = self._resolve_bootstrap_secret(request.bootstrap_secret)
        capabilities = sorted(set([request.capability, *request.token_capabilities]))
        token_response = await self._request_json(
            method="POST",
            base_url=bridge_url,
            path="/v1/bridge/token/issue",
            headers={"x-bridge-bootstrap-secret": bootstrap_secret},
            payload={
                "subject": request.subject or "drovi-agentos",
                "capabilities": capabilities,
                "ttl_seconds": request.token_ttl_seconds,
                "client": "drovi-intelligence",
            },
            timeout_seconds=timeout_seconds,
            error_code="agentos.desktop.token_issue_failed",
            error_message="Desktop bridge token issuance failed",
        )
        bearer_token = str(token_response.get("token") or "").strip()
        if not bearer_token:
            raise UpstreamError(
                code="agentos.desktop.token_missing",
                message="Desktop bridge did not return a capability token",
                status_code=502,
            )

        started = perf_counter()
        action_result = await self._request_json(
            method="POST",
            base_url=bridge_url,
            path="/v1/bridge/action",
            headers={"Authorization": f"Bearer {bearer_token}"},
            payload={
                "capability": request.capability,
                "payload": request.payload,
            },
            timeout_seconds=timeout_seconds,
            error_code="agentos.desktop.action_failed",
            error_message="Desktop bridge action failed",
        )
        latency_ms = int(max((perf_counter() - started) * 1000.0, 0.0))
        get_metrics().track_desktop_action(
            capability=request.capability,
            status="ok",
        )
        await emit_control_plane_audit_event(
            organization_id=request.organization_id,
            action="agentos.desktop.action.executed",
            actor_id=actor_id,
            resource_type="agent_desktop_action",
            resource_id=request.capability,
            metadata={
                "bridge_url": bridge_url,
                "latency_ms": latency_ms,
                "token_ttl_seconds": request.token_ttl_seconds,
                "metadata": request.metadata,
            },
        )
        raw_result = action_result.get("result")
        if isinstance(raw_result, dict):
            result_payload = raw_result
        else:
            result_payload = {"value": raw_result}
        return DesktopActionResponse(
            organization_id=request.organization_id,
            bridge_url=bridge_url,
            capability=request.capability,
            result=result_payload,
            latency_ms=latency_ms,
            token_expires_in_seconds=request.token_ttl_seconds,
            metadata=request.metadata,
        )

    async def health(self, *, request: DesktopBridgeHealthRequest) -> DesktopBridgeHealthResponse:
        bridge_url = self._resolve_bridge_url(request.bridge_url)
        timeout_seconds = self._resolve_timeout(None)
        body = await self._request_json(
            method="GET",
            base_url=bridge_url,
            path="/health",
            headers={},
            payload=None,
            timeout_seconds=timeout_seconds,
            error_code="agentos.desktop.health_failed",
            error_message="Desktop bridge health check failed",
        )
        return DesktopBridgeHealthResponse(
            status=str(body.get("status") or "unknown"),
            bridge_url=bridge_url,
            app_version=str(body.get("app_version")) if body.get("app_version") is not None else None,
            remote_disabled=bool(body.get("remote_disabled", False)),
            mtls=bool(body.get("mtls", False)),
            raw=body if isinstance(body, dict) else {},
        )

    async def disable_bridge(
        self,
        *,
        request: DesktopBridgeControlRequest,
        actor_id: str | None,
    ) -> DesktopBridgeControlResponse:
        return await self._control_bridge(
            request=request,
            actor_id=actor_id,
            path="/v1/bridge/control/disable",
            action="disable",
        )

    async def enable_bridge(
        self,
        *,
        request: DesktopBridgeControlRequest,
        actor_id: str | None,
    ) -> DesktopBridgeControlResponse:
        return await self._control_bridge(
            request=request,
            actor_id=actor_id,
            path="/v1/bridge/control/enable",
            action="enable",
        )

    async def _control_bridge(
        self,
        *,
        request: DesktopBridgeControlRequest,
        actor_id: str | None,
        path: str,
        action: str,
    ) -> DesktopBridgeControlResponse:
        bridge_url = self._resolve_bridge_url(request.bridge_url)
        timeout_seconds = self._resolve_timeout(None)
        disable_token = self._resolve_remote_disable_token(request.remote_disable_token)
        payload = {"reason": request.reason} if request.reason else {}
        body = await self._request_json(
            method="POST",
            base_url=bridge_url,
            path=path,
            headers={"x-remote-disable-token": disable_token},
            payload=payload,
            timeout_seconds=timeout_seconds,
            error_code=f"agentos.desktop.{action}_failed",
            error_message=f"Desktop bridge {action} command failed",
        )
        get_metrics().track_desktop_control(action=action, status="ok")
        await emit_control_plane_audit_event(
            organization_id=request.organization_id,
            action=f"agentos.desktop.bridge.{action}",
            actor_id=actor_id,
            resource_type="agent_desktop_bridge",
            resource_id=bridge_url,
            metadata={"reason": request.reason},
        )
        return DesktopBridgeControlResponse(
            ok=bool(body.get("ok", False)),
            bridge_url=bridge_url,
            remote_disabled=bool(body.get("remote_disabled", False)),
            raw=body if isinstance(body, dict) else {},
        )

    async def _request_json(
        self,
        *,
        method: str,
        base_url: str,
        path: str,
        headers: dict[str, str],
        payload: dict[str, Any] | None,
        timeout_seconds: float,
        error_code: str,
        error_message: str,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(base_url=base_url, timeout=timeout_seconds) as client:
                response = await client.request(
                    method=method.upper(),
                    url=path,
                    headers=headers,
                    json=payload,
                )
            if response.status_code >= 400:
                details = {}
                if response.content:
                    try:
                        details = response.json()
                    except Exception:
                        details = {"body": response.text[:500]}
                code = str(details.get("error") or details.get("code") or error_code)
                status_code = 502 if response.status_code >= 500 else response.status_code
                raise UpstreamError(
                    code=error_code,
                    message=error_message,
                    status_code=status_code,
                    meta={"bridge_error": code, "status_code": response.status_code, "details": details},
                )
            if not response.content:
                return {}
            payload_data = response.json()
            if not isinstance(payload_data, dict):
                return {"value": payload_data}
            return payload_data
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                code=error_code,
                message=error_message,
                status_code=502,
                meta={"error": str(exc), "path": path},
            ) from exc

    def _resolve_bridge_url(self, requested: str | None) -> str:
        settings = get_settings()
        bridge_url = str(requested or settings.agent_desktop_bridge_url or "").strip()
        if not bridge_url:
            raise ValidationError(
                code="agentos.desktop.bridge_url_required",
                message="Desktop bridge URL is required",
            )
        parsed = urlparse(bridge_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValidationError(
                code="agentos.desktop.bridge_url_invalid_scheme",
                message="Desktop bridge URL must use http or https",
                meta={"bridge_url": bridge_url},
            )
        allowed_hosts = {item.strip().lower() for item in settings.agent_desktop_allowed_hosts if item.strip()}
        if parsed.hostname and allowed_hosts and parsed.hostname.lower() not in allowed_hosts:
            raise ValidationError(
                code="agentos.desktop.bridge_host_not_allowed",
                message="Desktop bridge host is not allowed",
                meta={"host": parsed.hostname, "allowed_hosts": sorted(allowed_hosts)},
            )
        return bridge_url.rstrip("/")

    def _resolve_timeout(self, timeout_seconds: float | None) -> float:
        settings = get_settings()
        if timeout_seconds is None:
            return float(settings.agent_desktop_request_timeout_seconds)
        return float(timeout_seconds)

    def _resolve_bootstrap_secret(self, override: str | None) -> str:
        settings = get_settings()
        secret = str(override or settings.agent_desktop_bridge_bootstrap_secret or "").strip()
        if not secret:
            raise ValidationError(
                code="agentos.desktop.bootstrap_secret_missing",
                message="Desktop bridge bootstrap secret is not configured",
                status_code=403,
            )
        return secret

    def _resolve_remote_disable_token(self, override: str | None) -> str:
        settings = get_settings()
        token = str(override or settings.agent_desktop_bridge_remote_disable_token or "").strip()
        if not token:
            raise ValidationError(
                code="agentos.desktop.remote_disable_token_missing",
                message="Desktop bridge remote disable token is not configured",
                status_code=403,
            )
        return token
