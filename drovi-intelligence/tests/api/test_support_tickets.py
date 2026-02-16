"""API tests for Support tickets endpoints (Phase 5)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


@asynccontextmanager
async def _fake_session(session):
    yield session


class TestSupportTicketCreate:
    async def test_create_ticket_persists_and_sends_confirmation(self, async_client, app):
        # Override auth for this test to behave like a pilot session (not internal).
        from src.auth.context import AuthMetadata, AuthType
        from src.auth.middleware import APIKeyContext, get_api_key_context, get_auth_context

        session_ctx = APIKeyContext(
            organization_id="org_test",
            auth_subject_id="user_user_123",
            scopes=["read", "write"],
            metadata=AuthMetadata(
                auth_type=AuthType.SESSION,
                user_email="alice@example.com",
                user_id="user_123",
                key_id="session:user_123",
                key_name="Session: alice@example.com",
            ),
            is_internal=False,
            rate_limit_per_minute=1000,
        )

        async def _override_ctx():
            return session_ctx

        app.dependency_overrides[get_api_key_context] = _override_ctx
        app.dependency_overrides[get_auth_context] = _override_ctx

        session = AsyncMock()
        session.execute = AsyncMock(return_value=MagicMock())

        with patch("src.api.routes.support.get_db_session", lambda: _fake_session(session)), patch(
            "src.api.routes.support._get_user_email",
            AsyncMock(return_value="alice@example.com"),
        ), patch(
            "src.api.routes.support.record_audit_event",
            AsyncMock(return_value=None),
        ), patch(
            "src.api.routes.support.send_resend_email",
            AsyncMock(return_value=True),
        ) as mock_send:
            response = await async_client.post(
                "/api/v1/support/tickets",
                json={
                    "subject": "Login issue",
                    "message": "I cannot log in, I get stuck on the page.",
                    "route": "/login",
                    "locale": "en",
                    "diagnostics": {"foo": "bar"},
                },
            )

        assert response.status_code == 201
        data = response.json()
        assert data["ticket_id"].startswith("tkt_")
        assert data["status"] == "open"
        assert mock_send.await_count == 1


class TestSupportTicketAdminList:
    async def test_list_tickets_returns_rows(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.fetchall.return_value = [
            SimpleNamespace(
                id="tkt_abc123",
                organization_id="org_test",
                subject="Test",
                status="open",
                priority="normal",
                created_by_email="alice@example.com",
                assignee_email=None,
                created_via="web",
                created_at="2026-02-08T00:00:00Z",
                updated_at="2026-02-08T00:00:00Z",
                last_message_at="2026-02-08T00:00:00Z",
                message_count=1,
                last_message_preview="hello",
            )
        ]
        session.execute = AsyncMock(return_value=result)

        with patch("src.api.routes.support.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get("/api/v1/support/tickets")

        assert response.status_code == 200
        payload = response.json()
        assert payload["tickets"][0]["id"] == "tkt_abc123"

    async def test_list_tickets_returns_cursor_and_optional_total(self, async_client):
        session = AsyncMock()
        list_result = MagicMock()
        list_result.fetchall.return_value = [
            SimpleNamespace(
                id="tkt_abc123",
                organization_id="org_test",
                subject="Newest",
                status="open",
                priority="normal",
                created_by_email="alice@example.com",
                assignee_email=None,
                created_via="web",
                created_at="2026-02-08T00:00:00+00:00",
                updated_at="2026-02-09T00:00:00+00:00",
                last_message_at="2026-02-09T00:00:00+00:00",
                message_count=1,
                last_message_preview="hello",
            ),
            SimpleNamespace(
                id="tkt_old",
                organization_id="org_test",
                subject="Older",
                status="open",
                priority="normal",
                created_by_email="alice@example.com",
                assignee_email=None,
                created_via="web",
                created_at="2026-02-07T00:00:00+00:00",
                updated_at="2026-02-08T00:00:00+00:00",
                last_message_at="2026-02-08T00:00:00+00:00",
                message_count=1,
                last_message_preview="older",
            ),
        ]
        count_result = MagicMock()
        count_result.fetchone.return_value = SimpleNamespace(count=9)
        session.execute = AsyncMock(side_effect=[list_result, count_result])

        with patch("src.api.routes.support.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get(
                "/api/v1/support/tickets?limit=1&include_total=true"
            )

        assert response.status_code == 200
        payload = response.json()
        assert len(payload["tickets"]) == 1
        assert payload["has_more"] is True
        assert payload["cursor"]
        assert payload["total"] == 9


class TestSupportTicketAdminDetail:
    async def test_get_ticket_returns_ticket_and_messages(self, async_client):
        session = AsyncMock()

        ticket_result = MagicMock()
        ticket_result.fetchone.return_value = SimpleNamespace(
            id="tkt_abc123",
            organization_id="org_test",
            subject="Test",
            status="open",
            priority="normal",
            created_by_email="alice@example.com",
            assignee_email=None,
            created_via="web",
            created_at="2026-02-08T00:00:00Z",
            updated_at="2026-02-08T00:00:00Z",
            last_message_at="2026-02-08T00:00:00Z",
            message_count=2,
        )

        messages_result = MagicMock()
        messages_result.fetchall.return_value = [
            SimpleNamespace(
                id="msg1",
                direction="inbound",
                visibility="external",
                author_type="user",
                author_email="alice@example.com",
                body_text="hello",
                body_html=None,
                created_at="2026-02-08T00:00:00Z",
            )
        ]

        session.execute = AsyncMock(side_effect=[ticket_result, messages_result])

        with patch("src.api.routes.support.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get("/api/v1/support/tickets/tkt_abc123")

        assert response.status_code == 200
        payload = response.json()
        assert payload["ticket"]["id"] == "tkt_abc123"
        assert payload["messages"][0]["direction"] == "inbound"


class TestSupportTicketAdminUpdate:
    async def test_update_ticket_status(self, async_client):
        session = AsyncMock()
        result = MagicMock()
        result.rowcount = 1
        session.execute = AsyncMock(return_value=result)

        with patch("src.api.routes.support.get_db_session", lambda: _fake_session(session)), patch(
            "src.api.routes.support.record_audit_event",
            AsyncMock(return_value=None),
        ):
            response = await async_client.patch(
                "/api/v1/support/tickets/tkt_abc123",
                json={"status": "closed"},
            )

        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestSupportTicketAdminAddMessage:
    async def test_add_message_external_sends_email(self, async_client):
        session = AsyncMock()

        # Update ticket + fetch created_by_email/subject.
        insert_result = MagicMock()
        update_result = MagicMock()
        fetch_result = MagicMock()
        fetch_result.fetchone.return_value = SimpleNamespace(
            created_by_email="alice@example.com",
            subject="Test ticket",
        )
        session.execute = AsyncMock(side_effect=[insert_result, update_result, fetch_result])

        with patch("src.api.routes.support._get_ticket_org", AsyncMock(return_value="org_test")), patch(
            "src.api.routes.support.get_db_session", lambda: _fake_session(session)
        ), patch(
            "src.api.routes.support.record_audit_event",
            AsyncMock(return_value=None),
        ), patch(
            "src.api.routes.support.send_resend_email",
            AsyncMock(return_value=True),
        ) as mock_send:
            response = await async_client.post(
                "/api/v1/support/tickets/tkt_abc123/messages",
                json={"message": "Here is an update", "visibility": "external", "locale": "en"},
            )

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert mock_send.await_count == 1


class TestSupportTicketInboundEmail:
    async def test_inbound_email_rejects_wrong_token(self, async_client):
        settings = SimpleNamespace(support_inbound_token="token123")
        with patch("src.api.routes.support.get_settings", return_value=settings):
            response = await async_client.post(
                "/api/v1/support/inbound/email",
                headers={"X-Support-Inbound-Token": "bad"},
                json={
                    "from": "alice@example.com",
                    "to": ["support@drovi.co"],
                    "subject": "Help",
                    "text": "hi",
                    "raw": {},
                },
            )
        assert response.status_code == 401
