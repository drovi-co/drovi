from datetime import UTC, datetime

from src.features import FeatureLabelQualityValidator, FeatureSnapshot, LabelPipeline


def test_label_pipeline_generates_labels_for_all_event_families() -> None:
    labels = LabelPipeline().from_events(
        [
            {
                "event_type": "user_correction",
                "target_ref": "obj_1",
                "occurred_at": "2026-02-20T10:00:00Z",
                "verdict": "accepted",
            },
            {
                "event_type": "contradiction_outcome",
                "target_ref": "obj_2",
                "occurred_at": "2026-02-20T11:00:00Z",
                "outcome": "validated",
            },
            {
                "event_type": "intervention_outcome",
                "target_ref": "obj_3",
                "occurred_at": "2026-02-20T12:00:00Z",
                "success": True,
            },
        ]
    )

    assert len(labels) == 3
    assert {label.label_name for label in labels} == {
        "user_correction_quality",
        "contradiction_confirmed",
        "intervention_effective",
    }


def test_feature_label_quality_validator_flags_leakage_and_null_drift() -> None:
    snapshot = FeatureSnapshot(
        entity_id="obj_1",
        as_of=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
        values={"risk_score": None, "pressure_score": 0.8},
        provenance={
            "risk_score": {"source_table": "gold.risk", "available_at": "2026-02-20T10:30:00+00:00"},
            "pressure_score": {"source_table": "gold.risk", "available_at": "2026-02-20T09:30:00+00:00"},
        },
    )
    labels = LabelPipeline().from_events(
        [
            {
                "event_type": "user_correction",
                "target_ref": "obj_1",
                "occurred_at": "2026-02-20T10:00:00Z",
                "verdict": "accepted",
            }
        ]
    )

    report = FeatureLabelQualityValidator().validate(
        feature_snapshots=[snapshot],
        labels=labels,
        max_null_ratio=0.1,
        max_leakage_violations=0,
    )
    assert report.passed is False
    assert report.leakage_violations >= 1
    assert report.null_drift["risk_score"] == 1.0

