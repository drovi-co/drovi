from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import structlog

from src.config import get_settings
from src.kernel.errors import UpstreamError
from src.kernel.time import utc_now

from ..models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession
from ..provider import BrowserProvider

logger = structlog.get_logger()


class LocalPlaywrightProvider(BrowserProvider):
    provider_type = "local"

    def __init__(self) -> None:
        settings = get_settings()
        self._artifact_root = Path(settings.browser_artifact_storage_path).expanduser().resolve()
        self._artifact_root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, dict[str, Any]] = {}
        self._playwright_handles: dict[str, dict[str, Any]] = {}

    async def create_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        provider_session_id = f"local:{session_id}"
        session_state = {
            "organization_id": organization_id,
            "current_url": initial_url,
            "metadata": metadata,
            "created_at": utc_now().isoformat(),
        }
        self._sessions[provider_session_id] = session_state
        await self._maybe_start_playwright_session(
            provider_session_id=provider_session_id,
            initial_url=initial_url,
            metadata=metadata,
        )
        return BrowserProviderSession(
            provider_session_id=provider_session_id,
            provider=self.provider_type,
            current_url=initial_url,
            metadata={"mode": "playwright" if provider_session_id in self._playwright_handles else "simulated"},
        )

    async def resume_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        state = self._sessions.get(provider_session_id)
        if state is None:
            raise UpstreamError(
                code="agentos.browser.session_not_found",
                message="Local browser provider session not found",
                status_code=404,
                meta={"provider_session_id": provider_session_id},
            )
        if str(state.get("organization_id")) != organization_id:
            raise UpstreamError(
                code="agentos.browser.session_forbidden",
                message="Local browser provider session organization mismatch",
                status_code=403,
                meta={"provider_session_id": provider_session_id},
            )
        return BrowserProviderSession(
            provider_session_id=provider_session_id,
            provider=self.provider_type,
            current_url=state.get("current_url"),
            metadata={**(state.get("metadata") or {}), **(metadata or {})},
        )

    async def execute_action(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        state = self._sessions.get(provider_session_id)
        if state is None:
            raise UpstreamError(
                code="agentos.browser.session_not_found",
                message="Local browser provider session not found",
                status_code=404,
                meta={"provider_session_id": provider_session_id},
            )
        if str(state.get("organization_id")) != organization_id:
            raise UpstreamError(
                code="agentos.browser.session_forbidden",
                message="Local browser provider session organization mismatch",
                status_code=403,
                meta={"provider_session_id": provider_session_id},
            )

        if provider_session_id in self._playwright_handles:
            return await self._execute_action_playwright(
                provider_session_id=provider_session_id,
                request=request,
                metadata=metadata,
            )
        return await self._execute_action_simulated(
            provider_session_id=provider_session_id,
            request=request,
            metadata=metadata,
        )

    async def close_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> None:
        state = self._sessions.get(provider_session_id)
        if state is None:
            return
        if str(state.get("organization_id")) != organization_id:
            return
        handle = self._playwright_handles.pop(provider_session_id, None)
        if handle is not None:
            try:
                await handle["context"].tracing.stop()
            except Exception:
                pass
            try:
                await handle["browser"].close()
            except Exception:
                pass
            try:
                await handle["playwright"].stop()
            except Exception:
                pass
        self._sessions.pop(provider_session_id, None)

    async def _maybe_start_playwright_session(
        self,
        *,
        provider_session_id: str,
        initial_url: str | None,
        metadata: dict[str, Any],
    ) -> None:
        settings = get_settings()
        if not settings.browser_local_playwright_enabled:
            return
        try:
            from playwright.async_api import async_playwright  # type: ignore
        except Exception:
            logger.info("Playwright not available; local provider using simulated mode")
            return

        try:
            playwright = await async_playwright().start()
            browser = await playwright.chromium.launch(headless=settings.browser_local_headless)
            context = await browser.new_context()
            page = await context.new_page()
            if initial_url:
                await page.goto(initial_url, wait_until="domcontentloaded")
            trace_path = str(self._trace_file_path(provider_session_id))
            await context.tracing.start(name=provider_session_id, screenshots=True, snapshots=True, sources=False)
            self._playwright_handles[provider_session_id] = {
                "playwright": playwright,
                "browser": browser,
                "context": context,
                "page": page,
                "trace_path": trace_path,
                "metadata": metadata,
            }
        except Exception as exc:
            logger.warning(
                "Failed to initialize Playwright session; falling back to simulated mode",
                provider_session_id=provider_session_id,
                error=str(exc),
            )

    async def _execute_action_playwright(
        self,
        *,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        handle = self._playwright_handles[provider_session_id]
        page = handle["page"]
        timeout_ms = int(request.timeout_ms or get_settings().browser_action_timeout_ms)
        artifacts: dict[str, Any] = {}
        output: dict[str, Any] = {}
        try:
            if request.action == "navigate":
                if not request.url:
                    raise ValueError("navigate action requires url")
                response = await page.goto(str(request.url), wait_until="domcontentloaded", timeout=timeout_ms)
                output = {
                    "status_code": response.status if response is not None else None,
                    "ok": bool(response.ok) if response is not None else True,
                }
            elif request.action == "snapshot":
                screenshot_path = self._screenshot_file_path(provider_session_id)
                await page.screenshot(path=str(screenshot_path), full_page=True)
                artifacts["screenshot"] = str(screenshot_path)
                output = {"captured": True}
            elif request.action == "click":
                if not request.selector:
                    raise ValueError("click action requires selector")
                await page.click(request.selector, timeout=timeout_ms)
                output = {"clicked": request.selector}
            elif request.action == "type":
                if not request.selector:
                    raise ValueError("type action requires selector")
                await page.fill(request.selector, request.text or "", timeout=timeout_ms)
                output = {"typed_selector": request.selector, "text_length": len(request.text or "")}
            elif request.action == "upload":
                if not request.selector or not request.file_name:
                    raise ValueError("upload action requires selector and file_name")
                content = base64.b64decode((request.content_base64 or "").encode("utf-8")) if request.content_base64 else b""
                upload_file = self._artifact_root / f"{provider_session_id.replace(':', '_')}_{request.file_name}"
                upload_file.write_bytes(content)
                await page.set_input_files(request.selector, str(upload_file), timeout=timeout_ms)
                artifacts["upload_file"] = str(upload_file)
                output = {"uploaded_file": request.file_name}
            elif request.action == "download":
                output = {"note": "Playwright download capture requires explicit page event wiring"}
            else:
                raise ValueError(f"Unsupported action: {request.action}")

            current_url = page.url
            self._sessions[provider_session_id]["current_url"] = current_url
            trace_event_path = await self._write_trace_event(
                provider_session_id=provider_session_id,
                payload={"action": request.action, "metadata": metadata, "output": output},
            )
            artifacts.setdefault("trace", trace_event_path)
            return BrowserProviderActionResult(
                status="ok",
                current_url=current_url,
                artifacts=artifacts,
                output=output,
            )
        except Exception as exc:
            raise UpstreamError(
                code="agentos.browser.playwright_action_failed",
                message="Playwright action failed",
                meta={"action": request.action, "provider_session_id": provider_session_id, "error": str(exc)},
            ) from exc

    async def _execute_action_simulated(
        self,
        *,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        current_url = str(self._sessions[provider_session_id].get("current_url") or "")
        output: dict[str, Any] = {}
        if request.action == "navigate":
            current_url = str(request.url or current_url)
            output = {"navigated": bool(request.url)}
        elif request.action == "snapshot":
            output = {"captured": True}
        elif request.action == "click":
            output = {"clicked": request.selector or ""}
        elif request.action == "type":
            output = {"typed_selector": request.selector or "", "text_length": len(request.text or "")}
        elif request.action == "download":
            output = {"download_file": request.file_name or "download.bin"}
        elif request.action == "upload":
            output = {"upload_file": request.file_name or "upload.bin"}

        self._sessions[provider_session_id]["current_url"] = current_url
        trace_event_path = await self._write_trace_event(
            provider_session_id=provider_session_id,
            payload={
                "mode": "simulated",
                "action": request.action,
                "request": request.model_dump(mode="json"),
                "metadata": metadata,
                "output": output,
            },
        )
        artifacts = {"trace": trace_event_path}
        if request.action == "snapshot":
            screenshot_path = self._screenshot_file_path(provider_session_id)
            screenshot_path.write_text("simulated screenshot placeholder", encoding="utf-8")
            artifacts["screenshot"] = str(screenshot_path)
        return BrowserProviderActionResult(
            status="ok",
            current_url=current_url or None,
            artifacts=artifacts,
            output=output,
        )

    async def _write_trace_event(self, *, provider_session_id: str, payload: dict[str, Any]) -> str:
        path = self._trace_file_path(provider_session_id)
        existing: list[dict[str, Any]] = []
        if path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                existing = []
        existing.append({"ts": utc_now().isoformat(), "event": payload})
        path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        return str(path)

    def _trace_file_path(self, provider_session_id: str) -> Path:
        safe = provider_session_id.replace(":", "_")
        return self._artifact_root / f"{safe}.trace.json"

    def _screenshot_file_path(self, provider_session_id: str) -> Path:
        safe = provider_session_id.replace(":", "_")
        return self._artifact_root / f"{safe}.screenshot.png"
