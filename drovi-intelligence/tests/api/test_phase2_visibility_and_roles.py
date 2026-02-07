from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.api.routes.auth import require_pilot_auth
from src.auth.middleware import APIKeyContext, get_api_key_context
from src.auth.pilot_accounts import PilotToken

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _session_ctx(*, org_id: str = "org_test", user_id: str = "user_a", scopes: list[str] | None = None) -> APIKeyContext:
    return APIKeyContext(
        organization_id=org_id,
        scopes=scopes or ["read"],
        key_id=f"session:{user_id}",
        key_name="Session",
        is_internal=False,
        rate_limit_per_minute=1000,
    )


def _pilot_token(*, role: str = "pilot_member", org_id: str = "org_test", user_id: str = "user_a") -> PilotToken:
    now = datetime.now(timezone.utc)
    return PilotToken(
        sub=user_id,
        org_id=org_id,
        role=role,  # JWT role claim may be stale
        email="pilot@example.com",
        iat=now,
        exp=now + timedelta(hours=1),
    )


class TestRoleRevalidation:
    async def test_require_pilot_auth_overrides_role_from_db(self):
        token = _pilot_token(role="pilot_member")

        def fake_verify_jwt(_token_str: str):
            return token

        fake_db = AsyncMock()
        fake_db.execute.return_value = MagicMock(fetchone=MagicMock(return_value=SimpleNamespace(role="pilot_admin")))

        @asynccontextmanager
        async def fake_get_db_session():
            yield fake_db

        with patch("src.api.routes.auth.verify_jwt", fake_verify_jwt), patch(
            "src.db.client.get_db_session",
            fake_get_db_session,
        ):
            gen = require_pilot_auth(session="token")
            resolved = await gen.__anext__()
            assert resolved.role == "pilot_admin"
            await gen.aclose()


class TestPrivateVisibility:
    async def test_search_filters_uio_results_using_visibility_check(self, app, async_client):
        # Override auth to be a non-admin session user (so filtering applies).
        async def fake_ctx():
            return _session_ctx(org_id="org_test", user_id="user_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx

        fake_search = AsyncMock()
        fake_search.search.return_value = [
            {
                "id": "uio_visible",
                "type": "decision",
                "title": "Visible decision",
                "properties": {},
                "score": 1.0,
                "scores": {"vector": 1.0},
                "match_source": "vector",
            },
            {
                "id": "uio_hidden",
                "type": "decision",
                "title": "Hidden decision",
                "properties": {},
                "score": 0.9,
                "scores": {"vector": 0.9},
                "match_source": "vector",
            },
            {
                "id": "contact_1",
                "type": "contact",
                "title": "Contact",
                "properties": {},
                "score": 0.8,
                "scores": {"vector": 0.8},
                "match_source": "vector",
            },
        ]

        with patch("src.api.routes.search.get_hybrid_search", AsyncMock(return_value=fake_search)), patch(
            "src.auth.private_sources.filter_visible_uio_ids",
            AsyncMock(return_value={"uio_visible"}),
        ):
            response = await async_client.post(
                "/api/v1/search",
                json={"query": "decisions", "limit": 10},
            )

        assert response.status_code == 200
        data = response.json()
        ids = [r.get("id") for r in data.get("results", [])]
        assert "uio_visible" in ids
        assert "uio_hidden" not in ids
        assert "contact_1" in ids

    async def test_evidence_denies_private_uio_by_returning_404(self, app, async_client):
        async def fake_ctx():
            return _session_ctx(org_id="org_test", user_id="user_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx

        fake_row = SimpleNamespace(
            id="evid_1",
            source_type="manual",
            source_account_id="conn_private",
            conversation_id=None,
            message_id=None,
            quoted_text="hello",
            source_timestamp=None,
            unified_object_id="uio_hidden",
            organization_id="org_test",
        )

        fake_session = AsyncMock()
        fake_session.execute.return_value = MagicMock(fetchone=MagicMock(return_value=fake_row))

        @asynccontextmanager
        async def fake_get_db_session():
            yield fake_session

        from fastapi import HTTPException

        async def fake_require_visible(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Not found")

        with patch("src.db.client.get_db_session", fake_get_db_session), patch(
            "src.auth.private_sources.require_uio_visible",
            fake_require_visible,
        ):
            response = await async_client.get(
                "/api/v1/evidence/evid_1",
                params={"organization_id": "org_test", "mode": "snippet"},
            )

        assert response.status_code == 404
