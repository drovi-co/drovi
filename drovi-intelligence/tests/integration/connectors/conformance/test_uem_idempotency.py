import uuid

import pytest

from src.db import get_db_pool
from src.db.rls import rls_context
from src.ingestion.reality_events import persist_reality_event


@pytest.mark.integration
@pytest.mark.asyncio
async def test_persist_reality_event_is_idempotent() -> None:
    org_id = f"org_conformance_{uuid.uuid4().hex[:10]}"

    with rls_context(org_id, is_internal=True):
        event_id_1, created_1 = await persist_reality_event(
            organization_id=org_id,
            source_type="email",
            event_type="connector.record",
            content_text="Subject: Test\n\nHello world",
            source_id="msg_1",
            conversation_id="thread_1",
            message_id="msg_1",
        )
        event_id_2, created_2 = await persist_reality_event(
            organization_id=org_id,
            source_type="email",
            event_type="connector.record",
            content_text="Subject: Test\n\nHello world",
            source_id="msg_1",
            conversation_id="thread_1",
            message_id="msg_1",
        )

    assert created_1 is True
    assert created_2 is False
    assert event_id_2 == event_id_1

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM unified_event WHERE organization_id = $1",
            org_id,
        )
        # Cleanup
        await conn.execute("DELETE FROM unified_event WHERE organization_id = $1", org_id)

    assert count == 1

