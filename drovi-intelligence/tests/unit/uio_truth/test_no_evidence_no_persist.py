from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_no_evidence_no_persist_commitment(monkeypatch) -> None:
    from src.contexts.uio_truth.application.persist_commitments import persist_commitments

    captured: dict[str, object] = {}

    @asynccontextmanager
    async def fake_get_db_session():
        session = AsyncMock()
        captured["session"] = session
        yield session

    monkeypatch.setattr("src.db.client.get_db_session", fake_get_db_session)

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

    commitment = SimpleNamespace(
        id="c1",
        title="Do the thing",
        description="",
        confidence=0.9,
        quoted_text="   ",  # No evidence
    )

    metrics = SimpleNamespace(track_evidence_completeness=lambda **_kwargs: None)
    results = PersistResults()

    await persist_commitments(
        envelope=envelope,
        commitments=[commitment],
        merge_lookup={},
        results=results,
        metrics=metrics,
    )

    assert results.uios_created == []
    assert results.uios_merged == []

    session = captured.get("session")
    assert session is not None
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_no_evidence_no_persist_decision(monkeypatch) -> None:
    from src.contexts.uio_truth.application.persist_decisions import persist_decisions

    captured: dict[str, object] = {}

    @asynccontextmanager
    async def fake_get_db_session():
        session = AsyncMock()
        captured["session"] = session
        yield session

    monkeypatch.setattr("src.db.client.get_db_session", fake_get_db_session)

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

    decision = SimpleNamespace(
        id="d1",
        title="Approve budget",
        statement="",
        rationale="",
        confidence=0.9,
        quoted_text=None,  # No evidence
    )

    metrics = SimpleNamespace(track_evidence_completeness=lambda **_kwargs: None)
    results = PersistResults()

    await persist_decisions(
        envelope=envelope,
        decisions=[decision],
        merge_lookup={},
        results=results,
        metrics=metrics,
    )

    assert results.uios_created == []
    assert results.uios_merged == []

    session = captured.get("session")
    assert session is not None
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_no_evidence_no_persist_task(monkeypatch) -> None:
    from src.contexts.uio_truth.application.persist_tasks import persist_tasks

    captured: dict[str, object] = {}

    @asynccontextmanager
    async def fake_get_db_session():
        session = AsyncMock()
        captured["session"] = session
        yield session

    monkeypatch.setattr("src.db.client.get_db_session", fake_get_db_session)

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

    task = SimpleNamespace(
        id="t1",
        title="Do the task",
        description="",
        status="pending",
        confidence=0.9,
        quoted_text="   ",  # No evidence
    )

    metrics = SimpleNamespace(track_evidence_completeness=lambda **_kwargs: None)
    results = PersistResults()

    await persist_tasks(
        envelope=envelope,
        tasks=[task],
        commitments=[],
        decisions=[],
        merge_lookup={},
        results=results,
        metrics=metrics,
    )

    assert results.uios_created == []
    assert results.uios_merged == []

    session = captured.get("session")
    assert session is not None
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_no_evidence_no_persist_risk(monkeypatch) -> None:
    from src.contexts.uio_truth.application.persist_risks import persist_risks

    captured: dict[str, object] = {}

    @asynccontextmanager
    async def fake_get_db_session():
        session = AsyncMock()
        captured["session"] = session
        yield session

    monkeypatch.setattr("src.db.client.get_db_session", fake_get_db_session)

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

    risk = SimpleNamespace(
        id="r1",
        type="deadline_risk",
        title="Risk without quote",
        description="",
        severity="medium",
        confidence=0.8,
        quoted_text=None,  # No evidence
    )

    metrics = SimpleNamespace(track_evidence_completeness=lambda **_kwargs: None)
    results = PersistResults()

    await persist_risks(
        envelope=envelope,
        risks=[risk],
        merge_lookup={},
        results=results,
        metrics=metrics,
    )

    assert results.uios_created == []
    assert results.uios_merged == []

    session = captured.get("session")
    assert session is not None
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_no_evidence_no_persist_claim(monkeypatch) -> None:
    from src.contexts.uio_truth.application.persist_claims import persist_claims

    captured: dict[str, object] = {}

    @asynccontextmanager
    async def fake_get_db_session():
        session = AsyncMock()
        captured["session"] = session
        yield session

    monkeypatch.setattr("src.db.client.get_db_session", fake_get_db_session)

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

    claim = SimpleNamespace(
        id="cl1",
        type="promise",
        content="Claim text",
        confidence=0.9,
        quoted_text="",  # No evidence
    )

    metrics = SimpleNamespace(track_evidence_completeness=lambda **_kwargs: None)
    results = PersistResults()

    await persist_claims(
        envelope=envelope,
        claims=[claim],
        merge_lookup={},
        results=results,
        metrics=metrics,
    )

    assert results.uios_created == []
    assert results.uios_merged == []

    session = captured.get("session")
    assert session is not None
    session.execute.assert_not_called()
