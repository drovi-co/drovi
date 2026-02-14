from __future__ import annotations

from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.kernel.errors import UpstreamError

from ..models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession
from ..provider import BrowserProvider

logger = structlog.get_logger()


class ParallelBrowserProvider(BrowserProvider):
    """
    Parallel adapter under the BrowserProvider abstraction.

    The concrete endpoint contract is intentionally thin and can be swapped
    without changing agent playbooks.
    """

    provider_type = "parallel"

    async def create_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        body = await self._request(
            method="POST",
            path="/v1/browser/sessions",
            payload={
                "organization_id": organization_id,
                "session_id": session_id,
                "initial_url": initial_url,
                "metadata": metadata,
            },
            metadata=metadata,
        )
        return BrowserProviderSession(
            provider_session_id=str(body.get("provider_session_id") or f"parallel:{session_id}"),
            provider=self.provider_type,
            current_url=body.get("current_url"),
            artifacts=body.get("artifacts") or {},
            metadata=body.get("metadata") or {},
        )

    async def resume_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        body = await self._request(
            method="GET",
            path=f"/v1/browser/sessions/{provider_session_id}",
            payload={"organization_id": organization_id},
            metadata=metadata,
        )
        return BrowserProviderSession(
            provider_session_id=str(body.get("provider_session_id") or provider_session_id),
            provider=self.provider_type,
            current_url=body.get("current_url"),
            artifacts=body.get("artifacts") or {},
            metadata=body.get("metadata") or {},
        )

    async def execute_action(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        body = await self._request(
            method="POST",
            path=f"/v1/browser/sessions/{provider_session_id}/actions",
            payload={
                "organization_id": organization_id,
                "action": request.model_dump(mode="json"),
                "metadata": metadata,
            },
            metadata=metadata,
        )
        return BrowserProviderActionResult(
            status=body.get("status") or "ok",
            current_url=body.get("current_url"),
            artifacts=body.get("artifacts") or {},
            output=body.get("output") or {},
            error_message=body.get("error_message"),
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
            path=f"/v1/browser/sessions/{provider_session_id}/close",
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
        base_url = str(metadata.get("parallel_base_url") or settings.browser_parallel_base_url or "").strip()
        api_key = str(metadata.get("parallel_api_key") or settings.browser_parallel_api_key or "").strip()
        if not base_url:
            raise UpstreamError(
                code="agentos.browser.parallel_not_configured",
                message="Parallel browser provider base URL is not configured",
                status_code=503,
            )
        if not api_key:
            raise UpstreamError(
                code="agentos.browser.parallel_missing_api_key",
                message="Parallel browser provider API key is missing",
                status_code=403,
            )
        try:
            async with httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                timeout=float(settings.browser_parallel_timeout_seconds),
            ) as client:
                response = await client.request(
                    method=method.upper(),
                    url=path,
                    json=payload,
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if response.status_code >= 400:
                raise UpstreamError(
                    code="agentos.browser.parallel_request_failed",
                    message="Parallel browser provider request failed",
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
            logger.warning("Parallel browser provider request failed", error=str(exc), path=path)
            raise UpstreamError(
                code="agentos.browser.parallel_unavailable",
                message="Parallel browser provider unavailable",
                status_code=502,
                meta={"path": path, "error": str(exc)},
            ) from exc
