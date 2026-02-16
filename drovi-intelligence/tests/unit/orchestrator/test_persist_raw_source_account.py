from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from src.orchestrator.nodes.persist_raw_source_account import ensure_source_account_for_persistence

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_returns_existing_source_account_id_without_creating() -> None:
    conn = AsyncMock()
    conn.fetchval.side_effect = ["acct_existing"]

    result = await ensure_source_account_for_persistence(
        conn=conn,
        organization_id="org_1",
        source_account_id="acct_existing",
        source_type="email",
        user_email="user@drovi.co",
        now=datetime(2026, 2, 16, 0, 0, 0),
    )

    assert result == "acct_existing"
    conn.fetchrow.assert_not_awaited()


async def test_materializes_source_account_from_connection() -> None:
    conn = AsyncMock()
    conn.fetchval.side_effect = [None, None, "acct_created"]
    conn.fetchrow.return_value = {
        "id": "conn_1",
        "organization_id": "org_1",
        "connector_type": "gmail",
        "name": "Main Gmail",
        "created_by_user_id": "user_1",
    }

    result = await ensure_source_account_for_persistence(
        conn=conn,
        organization_id="org_1",
        source_account_id="conn_1",
        source_type="email",
        user_email="user@drovi.co",
        now=datetime(2026, 2, 16, 0, 0, 0),
    )

    assert result == "acct_created"
    assert conn.fetchval.await_count == 3
    insert_sql = conn.fetchval.await_args_list[-1].args[0]
    assert "INSERT INTO source_account" in insert_sql
    assert "ON CONFLICT (organization_id, type, external_id)" in insert_sql


async def test_reuses_existing_source_account_for_connection_external_id() -> None:
    conn = AsyncMock()
    conn.fetchval.side_effect = [None, "acct_existing_for_external"]
    conn.fetchrow.return_value = {
        "id": "conn_1",
        "organization_id": "org_1",
        "connector_type": "gmail",
        "name": "Main Gmail",
        "created_by_user_id": "user_1",
    }

    result = await ensure_source_account_for_persistence(
        conn=conn,
        organization_id="org_1",
        source_account_id="conn_1",
        source_type="email",
        user_email="user@drovi.co",
        now=datetime(2026, 2, 16, 0, 0, 0),
    )

    assert result == "acct_existing_for_external"
    assert conn.fetchval.await_count == 2


async def test_returns_none_when_source_account_and_connection_missing() -> None:
    conn = AsyncMock()
    conn.fetchval.side_effect = [None]
    conn.fetchrow.return_value = None

    result = await ensure_source_account_for_persistence(
        conn=conn,
        organization_id="org_1",
        source_account_id="missing_conn",
        source_type="email",
        user_email=None,
        now=datetime(2026, 2, 16, 0, 0, 0),
    )

    assert result is None
    assert conn.fetchval.await_count == 1
