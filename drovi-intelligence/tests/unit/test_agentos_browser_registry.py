from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from src.agentos.browser.models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession
from src.agentos.browser.provider import BrowserProvider
from src.agentos.browser.registry import BrowserProviderRegistry
from src.kernel.errors import UpstreamError


@dataclass
class _FakeProvider(BrowserProvider):
    provider_type: str
    fail: bool = False

    async def create_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict,
    ) -> BrowserProviderSession:
        if self.fail:
            raise UpstreamError(
                code=f"agentos.browser.{self.provider_type}_unavailable",
                message="provider unavailable",
                status_code=503,
            )
        return BrowserProviderSession(
            provider_session_id=f"{self.provider_type}:{session_id}",
            provider=self.provider_type,  # type: ignore[arg-type]
            current_url=initial_url,
        )

    async def resume_session(self, *, organization_id: str, provider_session_id: str, metadata: dict) -> BrowserProviderSession:
        return BrowserProviderSession(
            provider_session_id=provider_session_id,
            provider=self.provider_type,  # type: ignore[arg-type]
            current_url=None,
        )

    async def execute_action(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict,
    ) -> BrowserProviderActionResult:
        if self.fail:
            raise UpstreamError(
                code=f"agentos.browser.{self.provider_type}_unavailable",
                message="provider unavailable",
                status_code=503,
            )
        return BrowserProviderActionResult(status="ok", current_url=request.url, output={"provider": self.provider_type})

    async def close_session(self, *, organization_id: str, provider_session_id: str, metadata: dict) -> None:
        return None


@pytest.mark.asyncio
async def test_registry_create_session_falls_back_to_next_provider(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.registry.get_settings",
        lambda: SimpleNamespace(browser_provider_fallback_order=["managed", "parallel"]),
    )
    registry = BrowserProviderRegistry()
    registry._providers = {  # type: ignore[attr-defined]
        "local": _FakeProvider("local", fail=True),
        "managed": _FakeProvider("managed", fail=False),
        "parallel": _FakeProvider("parallel", fail=False),
    }
    session = await registry.create_session(
        provider="local",
        organization_id="org_test",
        session_id="agbrs_1",
        initial_url="https://example.com",
        metadata={},
        fallback_providers=["managed"],
    )
    assert session.provider == "managed"
    assert session.metadata["fallback_from"] == "local"


@pytest.mark.asyncio
async def test_registry_execute_action_returns_fallback_status(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.registry.get_settings",
        lambda: SimpleNamespace(browser_provider_fallback_order=["managed"]),
    )
    registry = BrowserProviderRegistry()
    registry._providers = {  # type: ignore[attr-defined]
        "local": _FakeProvider("local", fail=True),
        "managed": _FakeProvider("managed", fail=False),
        "parallel": _FakeProvider("parallel", fail=False),
    }
    provider, result = await registry.execute_action(
        provider="local",
        organization_id="org_test",
        provider_session_id="local:agbrs_1",
        request=BrowserProviderActionRequest(action="navigate", url="https://example.com"),
        metadata={},
        fallback_providers=["managed"],
    )
    assert provider == "managed"
    assert result.status == "fallback"
    assert result.fallback_from == "local"
