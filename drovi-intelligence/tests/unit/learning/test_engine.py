from datetime import UTC, datetime

from src.learning import CorrectionEvent, LearningEngine


def test_build_snapshot_computes_calibration_metrics() -> None:
    engine = LearningEngine()
    feedback = [
        engine.make_feedback(
            object_ref="belief_1",
            source_key="worldnews",
            predicted_probability=0.8,
            observed_outcome=1,
            observed_at=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
        ),
        engine.make_feedback(
            object_ref="belief_2",
            source_key="worldnews",
            predicted_probability=0.7,
            observed_outcome=0,
            observed_at=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
        ),
        engine.make_feedback(
            object_ref="belief_3",
            source_key="sec",
            predicted_probability=0.3,
            observed_outcome=0,
            observed_at=datetime(2026, 2, 20, 14, 0, tzinfo=UTC),
        ),
    ]

    snapshot = engine.build_snapshot(feedback)

    assert snapshot.sample_size == 3
    assert snapshot.brier_score > 0
    assert "worldnews" in snapshot.source_adjustments
    assert "sec" in snapshot.source_adjustments


def test_recalibrate_probability_shrinks_toward_center_with_high_error() -> None:
    engine = LearningEngine()
    adjusted = engine.recalibrate_probability(probability=0.9, reliability_error=0.9)
    assert 0.5 < adjusted < 0.9


def test_ingest_correction_events_maps_streams_to_feedback() -> None:
    engine = LearningEngine()
    feedback = engine.ingest_correction_events(
        [
            CorrectionEvent(
                event_id="ev_1",
                object_ref="obj_1",
                source_key="ui_feedback",
                event_type="user_correction",
                occurred_at=datetime(2026, 2, 20, 16, 0, tzinfo=UTC),
                metadata={"verdict": "rejected"},
            ),
            CorrectionEvent(
                event_id="ev_2",
                object_ref="obj_2",
                source_key="normative",
                event_type="contradiction_outcome",
                occurred_at=datetime(2026, 2, 20, 17, 0, tzinfo=UTC),
                metadata={"outcome": "validated"},
                predicted_probability=0.6,
            ),
        ]
    )

    assert len(feedback) == 2
    assert feedback[0].observed_outcome == 0
    assert feedback[1].observed_outcome == 1
    assert feedback[1].predicted_probability == 0.6


def test_decide_cadence_requires_due_window_and_minimum_feedback() -> None:
    engine = LearningEngine()
    now = datetime(2026, 2, 23, 10, 0, tzinfo=UTC)
    decision = engine.decide_cadence(
        last_recalibration_at=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
        last_retrain_at=datetime(2026, 2, 1, 10, 0, tzinfo=UTC),
        new_feedback_count=150,
        now=now,
    )
    assert decision.should_recalibrate is True
    assert decision.should_retrain is True
