from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.api.routes import org as org_route
from src.auth.pilot_accounts import PilotToken


class _FakeSessionContext:
    def __init__(self, session: AsyncMock):
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


def _token(role: str = "pilot_admin") -> PilotToken:
    now = datetime.now(timezone.utc)
    return PilotToken(
        sub="user_test",
        org_id="org_test",
        role=role,  # type: ignore[arg-type]
        email="test@example.com",
        iat=now,
        exp=now,
    )


@pytest.mark.asyncio
async def test_sync_allows_retry_when_connection_status_is_error() -> None:
    connection = SimpleNamespace(id=uuid4(), status="error", connector_type="documents")
    session = AsyncMock()

    with (
        patch("src.api.routes.org.get_db_session", lambda: _FakeSessionContext(session)),
        patch(
            "src.api.routes.org._require_connection_access",
            AsyncMock(return_value=connection),
        ),
        patch("src.jobs.queue.enqueue_job", AsyncMock(return_value="job_sync_1")),
    ):
        response = await org_route.trigger_connection_sync(
            connection_id=str(connection.id),
            request=org_route.SyncTriggerRequest(full_refresh=False, streams=[]),
            token=_token(),
        )

    assert response.status == "queued"
    assert response.connection_id == str(connection.id)


@pytest.mark.asyncio
async def test_backfill_allows_retry_when_connection_status_is_error() -> None:
    connection = SimpleNamespace(id=uuid4(), status="error", connector_type="documents")
    session = AsyncMock()

    with (
        patch("src.api.routes.org.get_db_session", lambda: _FakeSessionContext(session)),
        patch(
            "src.api.routes.org._require_connection_access",
            AsyncMock(return_value=connection),
        ),
        patch("src.jobs.queue.enqueue_job", AsyncMock(return_value="job_backfill_1")),
    ):
        response = await org_route.trigger_connection_backfill(
            connection_id=str(connection.id),
            request=org_route.BackfillRequest(
                start_date=datetime(2026, 2, 1, tzinfo=timezone.utc),
                end_date=datetime(2026, 2, 2, tzinfo=timezone.utc),
                window_days=1,
                streams=[],
                throttle_seconds=0.0,
            ),
            token=_token(),
        )

    assert response.status == "queued"
    assert response.connection_id == str(connection.id)


@pytest.mark.asyncio
async def test_sync_requires_oauth_reconnect_when_token_is_missing() -> None:
    connection = SimpleNamespace(id=uuid4(), status="error", connector_type="gmail")
    session = AsyncMock()
    session.execute = AsyncMock(
        return_value=SimpleNamespace(scalar_one_or_none=lambda: None)
    )

    with (
        patch("src.api.routes.org.get_db_session", lambda: _FakeSessionContext(session)),
        patch(
            "src.api.routes.org._require_connection_access",
            AsyncMock(return_value=connection),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await org_route.trigger_connection_sync(
                connection_id=str(connection.id),
                request=org_route.SyncTriggerRequest(full_refresh=False, streams=[]),
                token=_token(),
            )

    assert exc_info.value.status_code == 400
    assert "Reconnect the source first" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_sync_pending_auth_returns_reconnect_message() -> None:
    connection = SimpleNamespace(id=uuid4(), status="pending_auth", connector_type="gmail")
    session = AsyncMock()

    with (
        patch("src.api.routes.org.get_db_session", lambda: _FakeSessionContext(session)),
        patch(
            "src.api.routes.org._require_connection_access",
            AsyncMock(return_value=connection),
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await org_route.trigger_connection_sync(
                connection_id=str(connection.id),
                request=org_route.SyncTriggerRequest(full_refresh=False, streams=[]),
                token=_token(),
            )

    assert exc_info.value.status_code == 400
    assert "requires authentication" in str(exc_info.value.detail)
