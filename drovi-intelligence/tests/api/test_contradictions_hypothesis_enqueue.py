from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeUIOManager:
    def __init__(self) -> None:
        self.record_contradiction = AsyncMock(return_value="ctr_1")
        self.resolve_contradiction = AsyncMock(return_value=True)


async def test_high_severity_contradiction_enqueues_hypothesis_generation(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = _FakeUIOManager()
    enqueue_job_mock = AsyncMock(return_value="job_hyp_gen_1")
    audit_mock = AsyncMock()
    monkeypatch.setattr("src.api.routes.contradictions.get_uio_manager", AsyncMock(return_value=manager))
    monkeypatch.setattr("src.api.routes.contradictions.enqueue_job", enqueue_job_mock)
    monkeypatch.setattr(
        "src.api.routes.contradictions._lookup_source_reliability",
        AsyncMock(
            return_value={
                "source_key": "worldnewsapi",
                "score": 0.91,
                "band": "high",
                "corroboration_rate": 0.87,
                "false_positive_rate": 0.03,
            }
        ),
    )
    monkeypatch.setattr("src.api.routes.contradictions.record_audit_event", audit_mock)

    response = await async_client.post(
        "/api/v1/contradictions",
        json={
            "organization_id": "org_test",
            "uio_a_id": "uio_1",
            "uio_b_id": "uio_2",
            "contradiction_type": "policy_conflict",
            "severity": "high",
            "evidence_quote": "Conflicting promise detected in active contract.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["contradiction_id"] == "ctr_1"
    assert payload["hypothesis_job_id"] == "job_hyp_gen_1"
    assert payload["source_reliability"]["band"] == "high"
    assert payload["contradiction_confidence"] >= 0.8
    assert enqueue_job_mock.await_count == 1
    assert enqueue_job_mock.await_args.args[0].job_type == "hypothesis.generate"
    audit_mock.assert_awaited_once()


async def test_medium_severity_contradiction_skips_hypothesis_enqueue(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = _FakeUIOManager()
    enqueue_job_mock = AsyncMock(return_value="job_hyp_gen_1")
    monkeypatch.setattr(
        "src.api.routes.contradictions._lookup_source_reliability",
        AsyncMock(return_value={"source_key": None, "score": None, "band": "unknown"}),
    )
    monkeypatch.setattr("src.api.routes.contradictions.get_uio_manager", AsyncMock(return_value=manager))
    monkeypatch.setattr("src.api.routes.contradictions.enqueue_job", enqueue_job_mock)
    monkeypatch.setattr("src.api.routes.contradictions.record_audit_event", AsyncMock())

    response = await async_client.post(
        "/api/v1/contradictions",
        json={
            "organization_id": "org_test",
            "uio_a_id": "uio_1",
            "uio_b_id": "uio_2",
            "contradiction_type": "timeline_conflict",
            "severity": "medium",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["hypothesis_job_id"] is None
    assert payload["source_reliability"]["band"] == "unknown"
    assert enqueue_job_mock.await_count == 0


async def test_resolve_contradiction_records_audit_event(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = _FakeUIOManager()
    audit_mock = AsyncMock()
    monkeypatch.setattr("src.api.routes.contradictions.get_uio_manager", AsyncMock(return_value=manager))
    monkeypatch.setattr("src.api.routes.contradictions.record_audit_event", audit_mock)

    response = await async_client.post(
        "/api/v1/contradictions/ctr_1/resolve",
        json={
            "organization_id": "org_test",
            "resolution_reason": "Aligned legal interpretation and superseded stale clause.",
        },
    )

    assert response.status_code == 200
    assert response.json()["contradiction_id"] == "ctr_1"
    audit_mock.assert_awaited_once()
