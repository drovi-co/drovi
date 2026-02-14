from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.browser.models import BrowserActionRequest, BrowserSessionRecord
from src.agentos.browser.service import BrowserService
from src.kernel.errors import UpstreamError, ValidationError


def _session(*, status: str = "active", state: dict | None = None) -> BrowserSessionRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return BrowserSessionRecord(
        id="agbrs_1",
        organization_id="org_test",
        provider="local",
        status=status,  # type: ignore[arg-type]
        current_url="https://example.com",
        state=state if state is not None else {"provider_session_id": "local:agbrs_1", "fallback_providers": []},
        artifacts={},
        metadata={},
        created_at=now,
        updated_at=now,
        last_active_at=now,
    )


@pytest.mark.asyncio
async def test_execute_action_rejects_closed_session() -> None:
    persistence = SimpleNamespace(
        get_session=AsyncMock(return_value=_session(status="closed")),
    )
    service = BrowserService(
        persistence=persistence,  # type: ignore[arg-type]
        providers=SimpleNamespace(),  # type: ignore[arg-type]
        safety_policy=SimpleNamespace(enforce=lambda **_: None),  # type: ignore[arg-type]
        secrets=SimpleNamespace(),  # type: ignore[arg-type]
    )
    with pytest.raises(ValidationError) as exc:
        await service.execute_action(
            organization_id="org_test",
            session_id="agbrs_1",
            request=BrowserActionRequest(
                organization_id="org_test",
                action="navigate",
                url="https://example.com",
            ),
            actor_id="user_a",
        )
    assert exc.value.code == "agentos.browser.session_not_active"


@pytest.mark.asyncio
async def test_execute_action_rejects_missing_provider_session_id() -> None:
    persistence = SimpleNamespace(
        get_session=AsyncMock(return_value=_session(state={})),
    )
    service = BrowserService(
        persistence=persistence,  # type: ignore[arg-type]
        providers=SimpleNamespace(),  # type: ignore[arg-type]
        safety_policy=SimpleNamespace(enforce=lambda **_: None),  # type: ignore[arg-type]
        secrets=SimpleNamespace(),  # type: ignore[arg-type]
    )
    with pytest.raises(ValidationError) as exc:
        await service.execute_action(
            organization_id="org_test",
            session_id="agbrs_1",
            request=BrowserActionRequest(
                organization_id="org_test",
                action="navigate",
                url="https://example.com",
            ),
            actor_id="user_a",
        )
    assert exc.value.code == "agentos.browser.provider_session_missing"


@pytest.mark.asyncio
async def test_execute_action_persists_failure_log_for_provider_error() -> None:
    persistence = SimpleNamespace(
        get_session=AsyncMock(return_value=_session()),
        create_action_log=AsyncMock(return_value=SimpleNamespace(id="agbra_fail")),
    )
    providers = SimpleNamespace(
        execute_action=AsyncMock(
            side_effect=UpstreamError(
                code="agentos.browser.playwright_action_failed",
                message="selector drift",
                status_code=502,
            )
        )
    )
    service = BrowserService(
        persistence=persistence,  # type: ignore[arg-type]
        providers=providers,  # type: ignore[arg-type]
        safety_policy=SimpleNamespace(enforce=lambda **_: None),  # type: ignore[arg-type]
        secrets=SimpleNamespace(),  # type: ignore[arg-type]
    )
    with pytest.raises(UpstreamError):
        await service.execute_action(
            organization_id="org_test",
            session_id="agbrs_1",
            request=BrowserActionRequest(
                organization_id="org_test",
                action="click",
                selector="#submit",
            ),
            actor_id="user_a",
        )

    persistence.create_action_log.assert_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_code",
    [
        "agentos.browser.playwright_action_failed",  # selector drift
        "agentos.browser.download_timeout",  # download timeout
        "agentos.browser.navigation_dead_end",  # navigation dead end
    ],
)
async def test_execute_action_failure_variants_are_logged(error_code: str) -> None:
    persistence = SimpleNamespace(
        get_session=AsyncMock(return_value=_session()),
        create_action_log=AsyncMock(return_value=SimpleNamespace(id="agbra_fail")),
    )
    providers = SimpleNamespace(
        execute_action=AsyncMock(
            side_effect=UpstreamError(
                code=error_code,
                message="provider failure",
                status_code=502,
            )
        )
    )
    service = BrowserService(
        persistence=persistence,  # type: ignore[arg-type]
        providers=providers,  # type: ignore[arg-type]
        safety_policy=SimpleNamespace(enforce=lambda **_: None),  # type: ignore[arg-type]
        secrets=SimpleNamespace(),  # type: ignore[arg-type]
    )
    with pytest.raises(UpstreamError):
        await service.execute_action(
            organization_id="org_test",
            session_id="agbrs_1",
            request=BrowserActionRequest(
                organization_id="org_test",
                action="navigate",
                url="https://example.com",
            ),
            actor_id="user_a",
        )
    assert persistence.create_action_log.await_count >= 1
