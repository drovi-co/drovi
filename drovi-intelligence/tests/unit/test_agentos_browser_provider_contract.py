from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.browser.models import BrowserProviderActionRequest
from src.agentos.browser.providers.local_playwright import LocalPlaywrightProvider
from src.agentos.browser.providers.managed import ManagedBrowserProvider
from src.agentos.browser.providers.parallel import ParallelBrowserProvider


@pytest.mark.asyncio
async def test_local_provider_contract_navigate_snapshot_close(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.providers.local_playwright.get_settings",
        lambda: SimpleNamespace(
            browser_artifact_storage_path=str(tmp_path),
            browser_local_playwright_enabled=False,
            browser_local_headless=True,
            browser_action_timeout_ms=1000,
        ),
    )
    provider = LocalPlaywrightProvider()
    session = await provider.create_session(
        organization_id="org_test",
        session_id="agbrs_1",
        initial_url="https://example.com",
        metadata={},
    )
    result = await provider.execute_action(
        organization_id="org_test",
        provider_session_id=session.provider_session_id,
        request=BrowserProviderActionRequest(action="snapshot"),
        metadata={},
    )
    assert session.provider == "local"
    assert result.status == "ok"
    assert "trace" in result.artifacts
    await provider.close_session(
        organization_id="org_test",
        provider_session_id=session.provider_session_id,
        metadata={},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_cls", "provider_name"),
    [
        (ManagedBrowserProvider, "managed"),
        (ParallelBrowserProvider, "parallel"),
    ],
)
async def test_managed_provider_contract_shape(provider_cls, provider_name) -> None:
    provider = provider_cls()
    provider._request = AsyncMock(  # type: ignore[attr-defined]
        side_effect=[
            {"provider_session_id": f"{provider_name}:agbrs_1", "current_url": "https://example.com", "metadata": {}},
            {
                "status": "ok",
                "current_url": "https://example.com/form",
                "artifacts": {"trace": f"/tmp/{provider_name}.trace.json"},
                "output": {"ok": True},
            },
            {"ok": True},
        ]
    )
    session = await provider.create_session(
        organization_id="org_test",
        session_id="agbrs_1",
        initial_url="https://example.com",
        metadata={},
    )
    result = await provider.execute_action(
        organization_id="org_test",
        provider_session_id=session.provider_session_id,
        request=BrowserProviderActionRequest(action="navigate", url="https://example.com/form"),
        metadata={},
    )
    await provider.close_session(
        organization_id="org_test",
        provider_session_id=session.provider_session_id,
        metadata={},
    )
    assert session.provider == provider_name
    assert result.status == "ok"
    assert result.current_url == "https://example.com/form"
