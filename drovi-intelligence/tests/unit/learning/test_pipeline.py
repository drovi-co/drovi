from datetime import UTC, datetime

from src.learning import CorrectionEvent, LearningCadenceDecision, LearningPipeline


def test_learning_pipeline_ingest_builds_snapshot_and_source_counts() -> None:
    pipeline = LearningPipeline()
    result = pipeline.ingest_corrections(
        [
            CorrectionEvent(
                event_id="ev_1",
                object_ref="obj_1",
                source_key="feedback",
                event_type="user_correction",
                occurred_at=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
                metadata={"verdict": "accepted"},
            ),
            CorrectionEvent(
                event_id="ev_2",
                object_ref="obj_2",
                source_key="feedback",
                event_type="intervention_outcome",
                occurred_at=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
                metadata={"success": True},
            ),
        ]
    )

    payload = result.to_dict()
    assert payload["feedback_count"] == 2
    assert payload["snapshot"]["sample_size"] == 2
    assert payload["source_event_counts"]["user_correction"] == 1


def test_learning_pipeline_shadow_rollout_plan_caps_traffic_on_weak_calibration() -> None:
    pipeline = LearningPipeline()
    plan = pipeline.shadow_rollout_plan(
        candidate_model_id="mdl_candidate",
        baseline_model_id="mdl_baseline",
        calibration_snapshot=pipeline.ingest_corrections(
            [
                CorrectionEvent(
                    event_id="ev_1",
                    object_ref="obj_1",
                    source_key="feedback",
                    event_type="user_correction",
                    occurred_at=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
                    predicted_probability=0.9,
                    corrected_outcome=0,
                    metadata={},
                )
            ]
        ).snapshot,
        max_shadow_traffic_pct=25.0,
    )

    assert plan["mode"] == "shadow"
    assert plan["traffic_percentage"] <= 25.0


def test_learning_pipeline_scheduled_jobs_follow_cadence_decision() -> None:
    pipeline = LearningPipeline()
    decision = LearningCadenceDecision(
        should_recalibrate=True,
        should_retrain=True,
        reason="due",
        next_recalibration_at=datetime(2026, 2, 23, 9, 0, tzinfo=UTC),
        next_retrain_at=datetime(2026, 2, 23, 9, 0, tzinfo=UTC),
    )
    jobs = pipeline.scheduled_jobs_for_decision(organization_id="org_test", decision=decision)

    job_types = {item["job_type"] for item in jobs}
    assert "learning.recalibrate" in job_types
    assert "mlops.shadow.evaluate" in job_types

