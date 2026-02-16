from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.pool import NullPool


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
    fake_settings = SimpleNamespace(
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/drovi",
        db_raw_pool_min_size=3,
        db_raw_pool_max_size=11,
    )
    captured_kwargs: dict[str, object] = {}

    async def _fake_create_pool(dsn: str, init=None, **kwargs):
        assert init is not None
        await init(fake_conn)
        captured_kwargs.update(kwargs)
        return fake_raw_pool

    with patch("src.db.client.get_settings", return_value=fake_settings), patch(
        "asyncpg.create_pool",
        side_effect=_fake_create_pool,
    ):
        pool = await db_client.get_db_pool()

    assert pool is not None

    calls = fake_conn.set_type_codec.call_args_list
    assert any(call.args and call.args[0] == "json" for call in calls)
    assert any(call.args and call.args[0] == "jsonb" for call in calls)

    jsonb_call = next(call for call in calls if call.args and call.args[0] == "jsonb")
    assert jsonb_call.kwargs.get("schema") == "pg_catalog"
    assert jsonb_call.kwargs.get("format") == "text"
    assert captured_kwargs["min_size"] == 3
    assert captured_kwargs["max_size"] == 11


@pytest.mark.asyncio
async def test_init_db_uses_null_pool_when_configured(monkeypatch):
    from src.db import client as db_client

    monkeypatch.setattr(db_client, "_engine", None)
    monkeypatch.setattr(db_client, "_session_factory", None)

    fake_engine = AsyncMock()
    fake_settings = SimpleNamespace(
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/drovi",
        log_level="INFO",
        db_pool_mode="null",
        db_pool_size=20,
        db_pool_max_overflow=20,
        db_pool_timeout_seconds=30,
        db_pool_recycle_seconds=1800,
    )

    with patch("src.db.client.get_settings", return_value=fake_settings), patch(
        "src.db.client.create_async_engine",
        return_value=fake_engine,
    ) as create_engine:
        await db_client.init_db()

    kwargs = create_engine.call_args.kwargs
    assert kwargs["poolclass"] is NullPool
    assert "pool_size" not in kwargs


@pytest.mark.asyncio
async def test_init_db_uses_queue_pool_when_configured(monkeypatch):
    from src.db import client as db_client

    monkeypatch.setattr(db_client, "_engine", None)
    monkeypatch.setattr(db_client, "_session_factory", None)

    fake_engine = AsyncMock()
    fake_settings = SimpleNamespace(
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/drovi",
        log_level="INFO",
        db_pool_mode="pooled",
        db_pool_size=17,
        db_pool_max_overflow=9,
        db_pool_timeout_seconds=31,
        db_pool_recycle_seconds=1200,
    )

    with patch("src.db.client.get_settings", return_value=fake_settings), patch(
        "src.db.client.create_async_engine",
        return_value=fake_engine,
    ) as create_engine:
        await db_client.init_db()

    kwargs = create_engine.call_args.kwargs
    assert kwargs["pool_size"] == 17
    assert kwargs["max_overflow"] == 9
    assert kwargs["pool_timeout"] == 31
    assert kwargs["pool_recycle"] == 1200
    assert kwargs["pool_pre_ping"] is True
    assert "poolclass" not in kwargs
