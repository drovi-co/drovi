import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.ingestion.unified_event import build_content_hash, build_source_fingerprint
from src.orchestrator.nodes.persist_raw import persist_unified_events
from src.orchestrator.state import AnalysisInput, IntelligenceState, ParsedMessage


@pytest.mark.integration
@pytest.mark.asyncio
async def test_uem_persistence_inserts_records(monkeypatch):
    message = ParsedMessage(
        id="msg-1",
        content="We decided to use Stripe and I will send the proposal by Friday.",
        sender_email="jordan@example.com",
        sender_name="Jordan",
        sent_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        is_from_user=False,
    )

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org-1",
            content=message.content,
            source_type="email",
            source_id="thread-1",
            conversation_id="thread-1",
            user_email="leader@example.com",
            user_name="Leader",
            metadata={"subject": "Decision recap"},
        ),
        messages=[message],
    )

    conn = AsyncMock()
    conn.fetchrow.return_value = None
    conn.execute.return_value = "INSERT 1"

    class FakeAcquire:
        def __init__(self, connection):
            self._connection = connection

        async def __aenter__(self):
            return self._connection

        async def __aexit__(self, exc_type, exc, tb):
            return None

    class FakePool:
        def __init__(self, connection):
            self._connection = connection

        def acquire(self):
            return FakeAcquire(self._connection)

    pool = FakePool(conn)

    class FakeMetrics:
        enabled = True

        def track_uem_event(self, *args, **kwargs):
            return None

    monkeypatch.setattr("src.orchestrator.nodes.persist_raw.get_db_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr("src.orchestrator.nodes.persist_raw.get_metrics", lambda: FakeMetrics())

    now = datetime(2026, 2, 1, tzinfo=timezone.utc).replace(tzinfo=None)
    persisted = await persist_unified_events(state, now)
    assert persisted == 1

    expected_fingerprint = build_source_fingerprint(
        state.input.source_type,
        state.input.source_id,
        state.input.conversation_id,
        message.id,
    )
    expected_hash = build_content_hash(message.content, expected_fingerprint)

    insert_calls = [
        call for call in conn.execute.call_args_list
        if "INSERT INTO unified_event" in call.args[0]
    ]
    assert insert_calls, "Expected unified_event insert call"

    has_hash = any(expected_hash in call.args for call in insert_calls)
    assert has_hash

    metadata_json = None
    for call in insert_calls:
        for arg in call.args:
            if isinstance(arg, str) and "\"content_hash\"" in arg:
                metadata_json = arg
                break
        if metadata_json:
            break

    assert metadata_json is not None
    metadata = json.loads(metadata_json)
    assert metadata["content_hash"] == expected_hash
    assert metadata["source_fingerprint"] == expected_fingerprint
