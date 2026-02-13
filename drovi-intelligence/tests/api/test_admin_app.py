from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.config import get_settings

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _set_admin_env(monkeypatch, *, password: str = "test-admin-pass") -> None:
    monkeypatch.setenv("ADMIN_PASSWORD", password)
    get_settings.cache_clear()


class _FakeResult:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def __iter__(self):
        return iter(self._rows)

    def scalar(self):
        return self._scalar

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


async def test_admin_login_rejects_non_allowed_domain(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    res = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "person@gmail.com", "password": "test-admin-pass"},
    )
    assert res.status_code == 403


async def test_admin_login_and_me(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    res = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    assert res.status_code == 200
    token = res.json()["session_token"]

    me = await async_client_no_auth.get(
        "/api/v1/admin/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200
    data = me.json()
    assert data["email"] == "founder@drovi.co"


async def test_admin_kpis_smoke(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    login = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    token = login.json()["session_token"]

    fake_session = AsyncMock()

    async def _execute(stmt, params=None):
        sql = str(stmt)
        if "COUNT(*) FROM organizations" in sql:
            return _FakeResult(scalar=2)
        if "COUNT(*) FROM users" in sql and "last_login_at" not in sql:
            return _FakeResult(scalar=5)
        if "COUNT(*)\n                        FROM users" in sql:
            return _FakeResult(scalar=3)
        if "COUNT(*) FROM connections" in sql:
            return _FakeResult(scalar=7)
        if "FROM connections\n                GROUP BY connector_type" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(connector_type="gmail", count=4),
                    SimpleNamespace(connector_type="slack", count=3),
                ]
            )
        if "FROM connections\n                GROUP BY status" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(status="active", count=6),
                    SimpleNamespace(status="error", count=1),
                ]
            )
        if "FROM background_job\n                GROUP BY status" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(status="queued", count=2),
                    SimpleNamespace(status="running", count=1),
                ]
            )
        if "FROM background_job" in sql and "MIN(run_at)" in sql:
            return _FakeResult(scalar=12.0)
        if "FROM unified_event" in sql and "COUNT(*)" in sql:
            return _FakeResult(scalar=123)
        if "FROM unified_event" in sql and "MAX(received_at)" in sql:
            return _FakeResult(scalar=5.0)
        if "FROM sync_job_history" in sql and "status IN" in sql:
            return _FakeResult(scalar=10)
        if "FROM sync_job_history" in sql and "status = 'completed'" in sql:
            return _FakeResult(scalar=9)
        raise AssertionError(f"Unexpected KPI query: {sql}")

    fake_session.execute.side_effect = _execute

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin.get_db_session", fake_get_db_session):
        res = await async_client_no_auth.get(
            "/api/v1/admin/kpis",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 200
    payload = res.json()
    keys = {b["key"] for b in payload["blocks"]}
    assert "orgs" in keys
    assert "users" in keys
    assert "connections" in keys


async def test_admin_kpis_uses_cache_by_default(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    from src.api.routes import admin as admin_routes

    admin_routes._kpi_cache.clear()

    login = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    token = login.json()["session_token"]

    fake_session = AsyncMock()
    call_count = 0

    async def _execute(stmt, params=None):
        nonlocal call_count
        call_count += 1
        sql = str(stmt)
        if "GROUP BY" in sql:
            return _FakeResult(rows=[])
        return _FakeResult(scalar=0)

    fake_session.execute.side_effect = _execute

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin.get_db_session", fake_get_db_session):
        first = await async_client_no_auth.get(
            "/api/v1/admin/kpis",
            headers={"Authorization": f"Bearer {token}"},
        )
        first_count = call_count
        second = await async_client_no_auth.get(
            "/api/v1/admin/kpis",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first_count > 0
    assert call_count == first_count


async def test_admin_org_detail_smoke(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    login = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    token = login.json()["session_token"]

    fake_session = AsyncMock()

    async def _execute(stmt, params=None):
        sql = str(stmt)
        if "FROM organizations" in sql and "WHERE id = :org_id" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(
                        id="org_1",
                        name="Org One",
                        status="active",
                        region="us-west",
                        allowed_domains=["example.com"],
                        notification_emails=[],
                        allowed_connectors=None,
                        default_connection_visibility="org_shared",
                        created_at=None,
                        updated_at=None,
                        expires_at=None,
                    )
                ]
            )
        if "FROM memberships" in sql and "JOIN users" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(
                        user_id="user_1",
                        email="a@example.com",
                        name="A",
                        role="pilot_owner",
                        created_at=None,
                    )
                ]
            )
        if "FROM connections" in sql and "WHERE organization_id = :org_id" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(
                        id="c1",
                        connector_type="gmail",
                        name="Gmail",
                        status="active",
                        sync_enabled=True,
                        last_sync_at=None,
                        created_at=None,
                        created_by_user_id="user_1",
                        visibility="org_shared",
                    )
                ]
            )
        raise AssertionError(f"Unexpected org detail query: {sql}")

    fake_session.execute.side_effect = _execute

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin.get_db_session", fake_get_db_session):
        res = await async_client_no_auth.get(
            "/api/v1/admin/orgs/org_1",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "org_1"
    assert len(data["members"]) == 1
    assert len(data["connections"]) == 1


async def test_admin_user_detail_smoke(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    login = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    token = login.json()["session_token"]

    fake_session = AsyncMock()

    async def _execute(stmt, params=None):
        sql = str(stmt)
        if "FROM users" in sql and "WHERE id = :user_id" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(
                        id="user_1",
                        email="a@example.com",
                        name="A",
                        created_at=None,
                        last_login_at=None,
                    )
                ]
            )
        if "FROM memberships" in sql and "JOIN organizations" in sql:
            return _FakeResult(
                rows=[
                    SimpleNamespace(
                        org_id="org_1",
                        org_name="Org One",
                        role="pilot_member",
                        created_at=None,
                    )
                ]
            )
        raise AssertionError(f"Unexpected user detail query: {sql}")

    fake_session.execute.side_effect = _execute

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin.get_db_session", fake_get_db_session):
        res = await async_client_no_auth.get(
            "/api/v1/admin/users/user_1",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "user_1"
    assert len(data["memberships"]) == 1
