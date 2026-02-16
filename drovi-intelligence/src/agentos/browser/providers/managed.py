from __future__ import annotations

from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.kernel.errors import UpstreamError

from ..models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession
from ..provider import BrowserProvider

logger = structlog.get_logger()


class ManagedBrowserProvider(BrowserProvider):
    provider_type = "managed"

    async def create_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        response = await self._request(
            method="POST",
            path="/sessions",
            payload={
                "organization_id": organization_id,
                "session_id": session_id,
                "initial_url": initial_url,
                "metadata": metadata,
            },
            metadata=metadata,
        )
        provider_session_id = str(response.get("provider_session_id") or f"managed:{session_id}")
        return BrowserProviderSession(
            provider_session_id=provider_session_id,
            provider=self.provider_type,
            current_url=response.get("current_url"),
            artifacts=response.get("artifacts") or {},
            metadata=response.get("metadata") or {},
        )

    async def resume_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        response = await self._request(
            method="GET",
            path=f"/sessions/{provider_session_id}",
            payload={"organization_id": organization_id},
            metadata=metadata,
        )
        return BrowserProviderSession(
            provider_session_id=str(response.get("provider_session_id") or provider_session_id),
            provider=self.provider_type,
            current_url=response.get("current_url"),
            artifacts=response.get("artifacts") or {},
            metadata=response.get("metadata") or {},
        )

    async def execute_action(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        response = await self._request(
            method="POST",
            path=f"/sessions/{provider_session_id}/actions",
            payload={
                "organization_id": organization_id,
                "action": request.model_dump(mode="json"),
                "metadata": metadata,
            },
            metadata=metadata,
        )
        return BrowserProviderActionResult(
            status=response.get("status") or "ok",
            current_url=response.get("current_url"),
            artifacts=response.get("artifacts") or {},
            output=response.get("output") or {},
            error_message=response.get("error_message"),
        )

    async def close_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> None:
        await self._request(
            method="POST",
            path=f"/sessions/{provider_session_id}/close",
            payload={"organization_id": organization_id, "metadata": metadata},
            metadata=metadata,
        )

    async def _request(
        self,
        *,
        method: str,
        path: str,
        payload: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        settings = get_settings()
        base_url = str(metadata.get("managed_base_url") or settings.browser_managed_base_url or "").strip()
        api_key = str(metadata.get("managed_api_key") or settings.browser_managed_api_key or "").strip()
        if not base_url:
            raise UpstreamError(
                code="agentos.browser.managed_not_configured",
                message="Managed browser provider base URL is not configured",
                status_code=503,
            )
        if not api_key:
            raise UpstreamError(
                code="agentos.browser.managed_missing_api_key",
                message="Managed browser provider API key is missing",
                status_code=403,
            )

        try:
            async with httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                timeout=float(settings.browser_managed_timeout_seconds),
            ) as client:
                response = await client.request(
                    method=method.upper(),
                    url=path,
                    json=payload,
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if response.status_code >= 400:
                raise UpstreamError(
                    code="agentos.browser.managed_request_failed",
                    message="Managed browser provider request failed",
                    status_code=502,
                    meta={"status_code": response.status_code, "body": response.text[:500]},
                )
            body = response.json() if response.content else {}
            if not isinstance(body, dict):
                return {"output": {"raw": body}}
            return body
        except UpstreamError:
            raise
        except Exception as exc:
            logger.warning("Managed browser provider request failed", error=str(exc), path=path)
            raise UpstreamError(
                code="agentos.browser.managed_unavailable",
                message="Managed browser provider unavailable",
                status_code=502,
                meta={"path": path, "error": str(exc)},
            ) from exc
