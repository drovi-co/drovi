from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.normative.engine import NormativeConstraint, ViolationCandidate
from src.normative.service import NormativeIntelligenceService, _split_meta_suffix


@pytest.mark.asyncio
async def test_run_violation_sentinel_persists_and_publishes_signals() -> None:
    service = NormativeIntelligenceService(organization_id="org_1")
    service._load_active_constraints = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            NormativeConstraint(
                constraint_id="c1",
                title="Overdue cap",
                machine_rule="fact:internal.overdue_commitments <= 2",
                severity_on_breach="high",
                source_class="policy",
            )
        ]
    )
    service._build_fact_snapshot = AsyncMock(  # type: ignore[method-assign]
        return_value={"internal": {"overdue_commitments": 4}}
    )
    service._persist_violation_candidate = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda candidate: {
            "id": candidate.violation_id,
            "constraint_id": candidate.constraint_id,
            "status": candidate.status,
            "severity": candidate.severity,
            "confidence": candidate.confidence,
            "details": candidate.details,
            "detected_at": candidate.detected_at.isoformat(),
        }
    )
    service._publish_violation_event = AsyncMock()  # type: ignore[method-assign]

    result = await service.run_violation_sentinel(
        facts={},
        include_warnings=True,
        publish_events=True,
        max_constraints=100,
    )

    assert result["constraints_evaluated"] == 1
    assert result["signals_detected"] == 1
    assert result["signals_persisted"] == 1
    assert result["breaches"] == 1
    assert service._publish_violation_event.await_count == 1


@pytest.mark.asyncio
async def test_run_violation_sentinel_can_filter_warnings() -> None:
    service = NormativeIntelligenceService(organization_id="org_1")
    service._load_active_constraints = AsyncMock(  # type: ignore[method-assign]
        return_value=[
            NormativeConstraint(
                constraint_id="c2",
                title="Impact edges threshold",
                machine_rule="fact:external.high_impact_edges <= 10",
                severity_on_breach="medium",
                source_class="legal",
                pre_breach_threshold=0.8,
            )
        ]
    )
    service._build_fact_snapshot = AsyncMock(  # type: ignore[method-assign]
        return_value={"external": {"high_impact_edges": 9}}
    )
    service._persist_violation_candidate = AsyncMock(return_value=None)  # type: ignore[method-assign]
    service._publish_violation_event = AsyncMock()  # type: ignore[method-assign]

    result = await service.run_violation_sentinel(
        include_warnings=False,
        publish_events=True,
    )

    assert result["signals_detected"] == 0
    assert result["warnings"] == 0
    assert service._publish_violation_event.await_count == 0


def test_split_meta_suffix_extracts_rule_and_metadata() -> None:
    machine_rule = (
        "fact:internal.open_risks <= 3 "
        '#meta:{"scope_entities":["acme"],"scope_actions":["notify_gc"],"pre_breach_threshold":0.85}'
    )

    rule, meta = _split_meta_suffix(machine_rule)

    assert rule == "fact:internal.open_risks <= 3"
    assert meta["scope_entities"] == ["acme"]
    assert meta["scope_actions"] == ["notify_gc"]
    assert meta["pre_breach_threshold"] == 0.85


@pytest.mark.asyncio
async def test_persist_violation_candidate_encrypts_details_at_rest() -> None:
    service = NormativeIntelligenceService(organization_id="org_1")
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            SimpleNamespace(fetchone=lambda: None),
            SimpleNamespace(),
        ]
    )

    @asynccontextmanager
    async def fake_session():
        yield session

    candidate = ViolationCandidate(
        violation_id="viol_1",
        constraint_id="constraint_1",
        severity="high",
        confidence=0.81,
        status="open",
        detected_at=datetime.now(timezone.utc),
        details={
            "reason": "breach",
            "evidence_refs": ["ev_1"],
            "recommended_actions": ["notify_legal"],
            "dedupe_key": "abc123",
        },
    )

    with patch("src.normative.service.get_db_session", fake_session), patch(
        "src.normative.service.set_rls_context", lambda *_args, **_kwargs: None
    ):
        persisted = await service._persist_violation_candidate(candidate)

    assert persisted is not None
    insert_params = session.execute.await_args_list[1].args[1]
    details = insert_params["details"]
    assert details["dedupe_key"] == "abc123"
    assert "_enc" in details
    assert "ciphertext" in details["_enc"]
