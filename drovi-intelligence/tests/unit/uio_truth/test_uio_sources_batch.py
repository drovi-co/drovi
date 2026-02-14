from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.uio_sources import insert_uio_sources_batch

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_insert_uio_sources_batch_noop_when_empty() -> None:
    session = AsyncMock()
    envelope = PersistEnvelope(
        organization_id="org_1",
        source_type="email",
        source_account_id=None,
        conversation_id="thread_1",
        source_id="thread_1",
        analysis_id="analysis_1",
        messages=[],
        input_content="hello",
    )

    now = datetime(2026, 2, 10, 0, 0, 0)
    ids = await insert_uio_sources_batch(
        session=session,
        envelope=envelope,
        uio_id="uio_1",
        inserts=[],
        now=now,
    )

    assert ids == []
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_insert_uio_sources_batch_executes_executemany() -> None:
    session = AsyncMock()
    envelope = PersistEnvelope(
        organization_id="org_1",
        source_type="email",
        source_account_id="acct_1",
        conversation_id="thread_1",
        source_id="thread_1",
        analysis_id="analysis_1",
        messages=[],
        input_content="hello",
    )

    now = datetime(2026, 2, 10, 0, 0, 0)
    ids = await insert_uio_sources_batch(
        session=session,
        envelope=envelope,
        uio_id="uio_1",
        inserts=[
            {
                "role": "supporting",
                "message_id": "m1",
                "quoted_text": "alpha",
                "quoted_text_start": 1,
                "quoted_text_end": 6,
                "extracted_title": "t",
                "confidence": 0.9,
            },
            {
                # Role defaults to "supporting" when omitted.
                "message_id": "m2",
                "quoted_text": "beta",
                "quoted_text_start": 10,
                "quoted_text_end": 14,
                "extracted_title": "t",
                "confidence": 0.2,
            },
        ],
        now=now,
    )

    assert len(ids) == 2
    assert ids[0] != ids[1]

    session.execute.assert_awaited_once()
    args = session.execute.call_args.args
    assert len(args) == 2
    params_list = args[1]
    assert isinstance(params_list, list)
    assert len(params_list) == 2

    first = params_list[0]
    second = params_list[1]

    assert first["uio_id"] == "uio_1"
    assert first["conversation_id"] == "thread_1"
    assert first["source_account_id"] == "acct_1"
    assert first["role"] == "supporting"
    assert first["message_id"] == "m1"
    assert first["quoted_text"] == "alpha"

    assert second["uio_id"] == "uio_1"
    assert second["role"] == "supporting"
    assert second["message_id"] == "m2"
    assert second["quoted_text"] == "beta"

