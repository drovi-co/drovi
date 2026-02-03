from unittest.mock import AsyncMock

import pytest

from src.db import client as db_client
from src.db.rls import set_rls_context


@pytest.mark.asyncio
async def test_get_db_session_sets_rls_context():
    fake_session = AsyncMock()
    fake_session.execute = AsyncMock()
    fake_session.commit = AsyncMock()
    fake_session.rollback = AsyncMock()
    fake_session.close = AsyncMock()

    original_factory = db_client._session_factory
    db_client._session_factory = lambda: fake_session

    try:
        set_rls_context("org_123", is_internal=True)
        async with db_client.get_db_session():
            pass

        calls = [str(call.args[0]) for call in fake_session.execute.call_args_list]
        assert any("set_config('app.organization_id'" in c for c in calls)
        assert any("set_config('app.is_internal'" in c for c in calls)
    finally:
        db_client._session_factory = original_factory
        set_rls_context(None, is_internal=False)
