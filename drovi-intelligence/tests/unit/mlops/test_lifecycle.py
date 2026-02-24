from datetime import UTC, datetime

import pytest

from src.features import FeatureSnapshot, LabelRecord
from src.mlops import ModelCard, ModelRegistryV2, ReproducibleTrainingPipeline


def test_reproducible_training_pipeline_generates_stable_snapshot_and_artifact() -> None:
    pipeline = ReproducibleTrainingPipeline()
    snapshots = [
        FeatureSnapshot(
            entity_id="acct_1",
            as_of=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
            values={"risk_score": 0.7},
            provenance={"risk_score": {"source_table": "gold.risk"}},
        )
    ]
    labels = [
        LabelRecord(
            label_id="lbl_1",
            target_ref="acct_1",
            label_name="intervention_effective",
            label_value=1,
            label_time=datetime(2026, 2, 20, 11, 0, tzinfo=UTC),
            source_event_type="intervention_outcome",
        )
    ]
    snapshot = pipeline.create_dataset_snapshot(
        as_of=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
        source_tables=["gold.risk"],
        feature_snapshots=snapshots,
        labels=labels,
    )
    artifact = pipeline.train(
        model_family="temporal_forecast",
        dataset_snapshot=snapshot,
        hyperparameters={"depth": 3, "dropout": 0.1},
        code_inputs=["src/mlops/lifecycle.py", "src/features/point_in_time.py"],
    )

    assert snapshot.snapshot_id.startswith("ds_")
    assert artifact.artifact_id.startswith("mdl_")
    assert artifact.dataset_snapshot_id == snapshot.snapshot_id
    assert artifact.metrics["accuracy"] > 0


def test_hyperparameter_tuning_selects_best_candidate() -> None:
    pipeline = ReproducibleTrainingPipeline()
    result = pipeline.tune_hyperparameters(
        search_space={"depth": [2, 3], "dropout": [0.1, 0.3]},
        objective=lambda params: (1.0 - params["dropout"]) + (0.1 * params["depth"]),
    )

    assert result["best_params"] == {"depth": 3, "dropout": 0.1}
    assert result["evaluated_candidates"] == 4


def test_model_registry_requires_model_card_and_sequential_stage_promotions() -> None:
    pipeline = ReproducibleTrainingPipeline()
    snapshot = pipeline.create_dataset_snapshot(
        as_of=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
        source_tables=["gold.risk"],
        feature_snapshots=[],
        labels=[],
    )
    artifact = pipeline.train(
        model_family="verifier_nli",
        dataset_snapshot=snapshot,
        hyperparameters={"depth": 2, "dropout": 0.1},
        code_inputs=["src/mlops/baselines.py"],
    )
    registry = ModelRegistryV2()
    card = ModelCard(
        model_family="verifier_nli",
        version="1.0.0",
        use_case_bounds=["contradiction_scoring_only"],
        known_failure_modes=["sarcasm", "ambiguous_negation"],
        owners=["ml-team"],
        offline_metrics={"accuracy": 0.82},
        training_data_summary={"rows": 1000},
        created_at=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
    )
    registry.register(artifact=artifact, model_card=card)
    promoted_shadow = registry.promote(
        artifact_id=artifact.artifact_id,
        target_stage="shadow",
        gate_passed=True,
        reason="offline_pass",
    )

    assert promoted_shadow.stage == "shadow"
    with pytest.raises(ValueError):
        registry.promote(
            artifact_id=artifact.artifact_id,
            target_stage="prod",
            gate_passed=True,
            reason="skip_canary",
        )

