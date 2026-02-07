from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_get_db_pool_registers_json_codecs(monkeypatch):
    """
    Regression test: asyncpg defaults to treating JSON/JSONB as text.

    Our durable job plane writes dict payloads into JSON/JSONB columns, so the pool must
    register codecs during connection init.
    """
    from src.db import client as db_client

    # Ensure we don't reuse a cached pool from other tests.
    monkeypatch.setattr(db_client, "_pool", None)

    fake_conn = AsyncMock()
    fake_raw_pool = MagicMock()

    async def _fake_create_pool(dsn: str, init=None, **kwargs):
        assert init is not None
        await init(fake_conn)
        return fake_raw_pool

    with patch("asyncpg.create_pool", side_effect=_fake_create_pool):
        pool = await db_client.get_db_pool()

    assert pool is not None

    calls = fake_conn.set_type_codec.call_args_list
    assert any(call.args and call.args[0] == "json" for call in calls)
    assert any(call.args and call.args[0] == "jsonb" for call in calls)

    jsonb_call = next(call for call in calls if call.args and call.args[0] == "jsonb")
    assert jsonb_call.kwargs.get("schema") == "pg_catalog"
    assert jsonb_call.kwargs.get("format") == "text"
