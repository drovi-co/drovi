"""Reproducible training, tuning, and registry promotion workflows."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
import hashlib
import itertools
import json
from math import prod
from typing import Any, Callable

from src.features.schemas import FeatureSnapshot, LabelRecord
from src.kernel.time import utc_now
from src.mlops.models import DatasetSnapshot, ModelCard, ModelFamily, ModelStage, TrainingArtifact


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ReproducibleTrainingPipeline:
    """Creates deterministic data snapshots and train artifacts."""

    def create_dataset_snapshot(
        self,
        *,
        as_of: datetime,
        source_tables: list[str],
        feature_snapshots: list[FeatureSnapshot],
        labels: list[LabelRecord],
        metadata: dict[str, Any] | None = None,
    ) -> DatasetSnapshot:
        features_serialized = [
            {
                "entity_id": snapshot.entity_id,
                "as_of": snapshot.as_of.isoformat(),
                "values": snapshot.values,
                "provenance": snapshot.provenance,
            }
            for snapshot in feature_snapshots
        ]
        labels_serialized = [
            {
                "label_id": label.label_id,
                "target_ref": label.target_ref,
                "label_name": label.label_name,
                "label_value": label.label_value,
                "label_time": label.label_time.isoformat(),
            }
            for label in labels
        ]

        feature_hash = _stable_hash(features_serialized)
        label_hash = _stable_hash(labels_serialized)
        snapshot_digest = _stable_hash(
            {
                "as_of": as_of.isoformat(),
                "source_tables": sorted(source_tables),
                "feature_hash": feature_hash,
                "label_hash": label_hash,
            }
        )[:16]
        return DatasetSnapshot(
            snapshot_id=f"ds_{snapshot_digest}",
            as_of=as_of,
            source_tables=sorted(source_tables),
            row_count=len(feature_snapshots),
            feature_hash=feature_hash,
            label_hash=label_hash,
            metadata=metadata or {},
        )

    def train(
        self,
        *,
        model_family: ModelFamily,
        dataset_snapshot: DatasetSnapshot,
        hyperparameters: dict[str, Any],
        code_inputs: list[str],
        stage: ModelStage = "dev",
        metadata: dict[str, Any] | None = None,
    ) -> TrainingArtifact:
        config_hash = _stable_hash(hyperparameters)
        code_hash = _stable_hash(sorted(code_inputs))
        artifact_digest = _stable_hash(
            {
                "model_family": model_family,
                "dataset_snapshot_id": dataset_snapshot.snapshot_id,
                "config_hash": config_hash,
                "code_hash": code_hash,
            }
        )[:16]

        quality_bias = {
            "temporal_forecast": 0.74,
            "graph_impact": 0.71,
            "verifier_nli": 0.77,
            "generic": 0.69,
        }.get(model_family, 0.65)
        data_factor = min(1.0, dataset_snapshot.row_count / 250.0)
        regularization = 1.0 - min(0.15, abs(_safe_float(hyperparameters.get("dropout"), 0.1) - 0.1))
        accuracy = max(0.0, min(1.0, quality_bias + (0.2 * data_factor * regularization)))
        calibration_error = max(0.01, 0.22 - (0.12 * data_factor))
        latency_ms = max(20.0, 220.0 + (35.0 * _safe_float(hyperparameters.get("depth"), 3.0)))

        return TrainingArtifact(
            artifact_id=f"mdl_{artifact_digest}",
            model_family=model_family,
            stage=stage,
            dataset_snapshot_id=dataset_snapshot.snapshot_id,
            config_hash=config_hash,
            code_hash=code_hash,
            hyperparameters=dict(hyperparameters),
            metrics={
                "accuracy": round(accuracy, 4),
                "calibration_error": round(calibration_error, 4),
                "latency_ms": round(latency_ms, 2),
            },
            model_uri=f"model://{model_family}/{artifact_digest}",
            created_at=utc_now(),
            metadata=metadata or {},
        )

    def tune_hyperparameters(
        self,
        *,
        search_space: dict[str, list[Any]],
        objective: Callable[[dict[str, Any]], float],
    ) -> dict[str, Any]:
        if not search_space:
            raise ValueError("search_space cannot be empty")
        if any(not values for values in search_space.values()):
            raise ValueError("search_space entries cannot be empty lists")

        keys = sorted(search_space)
        best_params: dict[str, Any] | None = None
        best_score = float("-inf")

        for combo in itertools.product(*(search_space[key] for key in keys)):
            params = {key: combo[idx] for idx, key in enumerate(keys)}
            score = float(objective(params))
            if score > best_score:
                best_score = score
                best_params = params

        if best_params is None:
            raise RuntimeError("No hyperparameter candidate evaluated")
        return {
            "best_params": best_params,
            "best_score": round(best_score, 6),
            "evaluated_candidates": int(prod([len(search_space[key]) for key in keys])),
        }


class ModelRegistryV2:
    """In-memory registry with strict stage promotions and model-card requirements."""

    _STAGE_ORDER: dict[ModelStage, int] = {
        "dev": 0,
        "shadow": 1,
        "canary": 2,
        "prod": 3,
    }

    def __init__(self) -> None:
        self._artifacts: dict[str, TrainingArtifact] = {}
        self._cards: dict[str, ModelCard] = {}
        self._stage_index: dict[tuple[ModelFamily, ModelStage], str] = {}

    def register(self, *, artifact: TrainingArtifact, model_card: ModelCard) -> None:
        if model_card.model_family != artifact.model_family:
            raise ValueError("model card family mismatch")
        if not model_card.use_case_bounds or not model_card.known_failure_modes:
            raise ValueError("model card missing required constraints/failure modes")
        self._artifacts[artifact.artifact_id] = artifact
        self._cards[artifact.artifact_id] = model_card
        self._stage_index[(artifact.model_family, artifact.stage)] = artifact.artifact_id

    def promote(
        self,
        *,
        artifact_id: str,
        target_stage: ModelStage,
        gate_passed: bool,
        reason: str,
    ) -> TrainingArtifact:
        artifact = self._artifacts.get(artifact_id)
        if artifact is None:
            raise ValueError(f"Unknown artifact_id: {artifact_id}")
        if artifact_id not in self._cards:
            raise ValueError("Cannot promote artifact without model card")
        if not gate_passed:
            raise ValueError("Promotion blocked by regression gate")
        current_rank = self._STAGE_ORDER[artifact.stage]
        target_rank = self._STAGE_ORDER[target_stage]
        if target_rank > current_rank + 1:
            raise ValueError("Stage promotions must be sequential")

        promoted = replace(
            artifact,
            stage=target_stage,
            metadata={**artifact.metadata, "promotion_reason": reason, "promoted_at": utc_now().isoformat()},
        )
        self._artifacts[artifact_id] = promoted
        self._stage_index[(promoted.model_family, target_stage)] = promoted.artifact_id
        return promoted

    def get(self, artifact_id: str) -> TrainingArtifact | None:
        return self._artifacts.get(artifact_id)

    def get_by_stage(self, *, model_family: ModelFamily, stage: ModelStage) -> TrainingArtifact | None:
        artifact_id = self._stage_index.get((model_family, stage))
        if artifact_id is None:
            return None
        return self._artifacts.get(artifact_id)

    def lineage_manifest(
        self,
        *,
        artifact_id: str,
        snapshots: dict[str, DatasetSnapshot],
    ) -> dict[str, Any]:
        artifact = self._artifacts.get(artifact_id)
        if artifact is None:
            raise ValueError(f"Unknown artifact_id: {artifact_id}")
        snapshot = snapshots.get(artifact.dataset_snapshot_id)
        if snapshot is None:
            raise ValueError("Dataset snapshot not found for artifact")
        card = self._cards.get(artifact_id)
        return {
            "artifact_id": artifact.artifact_id,
            "stage": artifact.stage,
            "model_family": artifact.model_family,
            "dataset_snapshot": {
                "snapshot_id": snapshot.snapshot_id,
                "as_of": snapshot.as_of.isoformat(),
                "row_count": snapshot.row_count,
                "feature_hash": snapshot.feature_hash,
                "label_hash": snapshot.label_hash,
                "source_tables": snapshot.source_tables,
            },
            "config_hash": artifact.config_hash,
            "code_hash": artifact.code_hash,
            "hyperparameters": artifact.hyperparameters,
            "metrics": artifact.metrics,
            "model_uri": artifact.model_uri,
            "model_card": {
                "use_case_bounds": card.use_case_bounds if card else [],
                "known_failure_modes": card.known_failure_modes if card else [],
                "owners": card.owners if card else [],
            },
        }
