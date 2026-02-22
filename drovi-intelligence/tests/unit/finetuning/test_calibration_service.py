from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.finetuning.calibration import CalibrationService, OutcomeStatus, PredictionType


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _Acquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Pool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _Acquire(self._conn)


def _prediction_row(prediction_id: str = "pred_1") -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": prediction_id,
        "organization_id": "org_1",
        "uio_id": "uio_1",
        "prediction_type": PredictionType.COMMITMENT_FULFILLED.value,
        "predicted_outcome": {"description": "commitment completes", "probability": 0.8},
        "confidence": 0.8,
        "predicted_at": now,
        "evaluate_by": None,
        "actual_outcome": None,
        "outcome_status": OutcomeStatus.PENDING.value,
        "outcome_recorded_at": None,
        "outcome_source": None,
        "calibration_error": None,
        "brier_score": None,
        "model_used": "gpt-test",
        "extraction_context": {"evidenceIds": ["uio_1"]},
    }


@pytest.mark.asyncio
async def test_record_prediction_persists(monkeypatch):
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    pool = _Pool(conn)

    async def _pool_factory():
        return pool

    monkeypatch.setattr("src.finetuning.calibration.get_raw_query_pool", _pool_factory)

    service = CalibrationService()
    prediction = await service.record_prediction(
        organization_id="org_1",
        prediction_type=PredictionType.COMMITMENT_FULFILLED,
        predicted_outcome={"description": "commitment completes", "probability": 0.8},
        confidence=0.8,
        uio_id="uio_1",
    )

    assert prediction.organization_id == "org_1"
    assert prediction.prediction_type == PredictionType.COMMITMENT_FULFILLED
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_record_outcome_updates_prediction(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=_prediction_row("pred_42"))
    conn.execute = AsyncMock(return_value="UPDATE 1")
    pool = _Pool(conn)

    service = CalibrationService(db_session=pool)
    updated = await service.record_outcome(
        prediction_id="pred_42",
        was_correct=True,
        actual_outcome={"matched": True},
        source="user_feedback",
    )

    assert updated is not None
    assert updated.outcome_status == OutcomeStatus.CONFIRMED
    assert updated.brier_score is not None
    assert updated.calibration_error is not None
    assert conn.execute.await_count == 1


@pytest.mark.asyncio
async def test_get_resolved_predictions_parses_rows():
    now = datetime.now(timezone.utc)
    row_ok = _prediction_row("pred_ok")
    row_ok["outcome_status"] = OutcomeStatus.CONFIRMED.value
    row_ok["actual_outcome"] = {"matched": True}
    row_ok["outcome_recorded_at"] = now
    row_ok["brier_score"] = 0.04
    row_ok["calibration_error"] = 0.2

    row_bad = _prediction_row("pred_bad")
    row_bad["prediction_type"] = "unknown_prediction_type"
    row_bad["outcome_status"] = OutcomeStatus.CONFIRMED.value

    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[row_ok, row_bad])
    pool = _Pool(conn)

    service = CalibrationService(db_session=pool)
    predictions = await service._get_resolved_predictions(
        organization_id="org_1",
        prediction_type=None,
        days=90,
    )

    assert len(predictions) == 1
    assert predictions[0].id == "pred_ok"
