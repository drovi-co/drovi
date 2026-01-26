"""
Model Registry and Deployment Manager.

Tracks model versions and manages deployment lifecycle:
- Version tracking (testing → canary → production → deprecated)
- Traffic routing for canary deployments
- Rollback capabilities
"""

import hashlib
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import aiofiles
import structlog

from src.config import get_settings

from .schemas import ModelVersion, TaskType

logger = structlog.get_logger()


class ModelRegistry:
    """
    Registry for tracking fine-tuned model versions.

    Model lifecycle:
    testing → canary → production → deprecated
    """

    def __init__(self, registry_path: str | None = None):
        """
        Initialize the model registry.

        Args:
            registry_path: Path to store registry data
        """
        settings = get_settings()
        self.registry_path = Path(
            registry_path or settings.training_data_path
        ) / "registry"
        self.registry_path.mkdir(parents=True, exist_ok=True)

        self._models: dict[str, ModelVersion] = {}
        self._load_registry()

    def _load_registry(self):
        """Load existing registry from disk."""
        registry_file = self.registry_path / "models.json"
        if registry_file.exists():
            with open(registry_file) as f:
                data = json.load(f)
                for model_data in data.get("models", []):
                    model = ModelVersion.model_validate(model_data)
                    self._models[model.id] = model

    def _save_registry(self):
        """Save registry to disk."""
        registry_file = self.registry_path / "models.json"
        data = {
            "models": [m.model_dump(mode="json") for m in self._models.values()],
            "updated_at": datetime.utcnow().isoformat(),
        }
        with open(registry_file, "w") as f:
            json.dump(data, f, indent=2)

    def register_model(
        self,
        task_type: TaskType,
        model_id: str,
        base_model: str,
        provider: str = "together",
        version: str = "1.0.0",
        fine_tuning_job_id: str | None = None,
        training_samples: int = 0,
    ) -> ModelVersion:
        """
        Register a new fine-tuned model.

        Args:
            task_type: Task the model is for
            model_id: Provider model ID
            base_model: Base model it was fine-tuned from
            provider: Provider hosting the model
            version: Semantic version
            fine_tuning_job_id: ID of the fine-tuning job
            training_samples: Number of training samples used

        Returns:
            Registered ModelVersion
        """
        internal_id = f"{task_type.value}-{version}-{uuid.uuid4().hex[:8]}"

        model = ModelVersion(
            id=internal_id,
            task_type=task_type,
            model_id=model_id,
            base_model=base_model,
            provider=provider,
            version=version,
            version_suffix=f"drovi-{task_type.value}",
            status="testing",
            traffic_percentage=0.0,
            fine_tuning_job_id=fine_tuning_job_id,
            training_samples=training_samples,
            created_at=datetime.utcnow(),
        )

        self._models[internal_id] = model
        self._save_registry()

        logger.info(
            "Model registered",
            internal_id=internal_id,
            model_id=model_id,
            task_type=task_type.value,
        )

        return model

    def get(self, internal_id: str) -> ModelVersion | None:
        """Get a model by internal ID."""
        return self._models.get(internal_id)

    def get_by_model_id(self, model_id: str) -> ModelVersion | None:
        """Get a model by provider model ID."""
        for model in self._models.values():
            if model.model_id == model_id:
                return model
        return None

    def get_production_model(self, task_type: TaskType) -> ModelVersion | None:
        """Get the current production model for a task."""
        for model in self._models.values():
            if model.task_type == task_type and model.status == "production":
                return model
        return None

    def get_canary_model(self, task_type: TaskType) -> ModelVersion | None:
        """Get the current canary model for a task."""
        for model in self._models.values():
            if model.task_type == task_type and model.status == "canary":
                return model
        return None

    def get_active_models(self, task_type: TaskType) -> list[ModelVersion]:
        """Get all active models (canary + production) for routing."""
        return [
            m for m in self._models.values()
            if m.task_type == task_type and m.status in ("canary", "production")
        ]

    def list_models(
        self,
        task_type: TaskType | None = None,
        status: str | None = None,
    ) -> list[ModelVersion]:
        """
        List models with optional filtering.

        Args:
            task_type: Filter by task type
            status: Filter by status

        Returns:
            List of matching models
        """
        models = list(self._models.values())

        if task_type:
            models = [m for m in models if m.task_type == task_type]

        if status:
            models = [m for m in models if m.status == status]

        return sorted(models, key=lambda m: m.created_at, reverse=True)

    def update_model(self, internal_id: str, **updates) -> ModelVersion | None:
        """Update a model's attributes."""
        model = self._models.get(internal_id)
        if not model:
            return None

        for key, value in updates.items():
            if hasattr(model, key):
                setattr(model, key, value)

        self._save_registry()
        return model

    def update_metrics(
        self,
        internal_id: str,
        accuracy: float | None = None,
        precision: float | None = None,
        recall: float | None = None,
        f1_score: float | None = None,
        latency_p50_ms: float | None = None,
        latency_p99_ms: float | None = None,
    ) -> ModelVersion | None:
        """Update model performance metrics."""
        updates = {}
        if accuracy is not None:
            updates["accuracy"] = accuracy
        if precision is not None:
            updates["precision"] = precision
        if recall is not None:
            updates["recall"] = recall
        if f1_score is not None:
            updates["f1_score"] = f1_score
        if latency_p50_ms is not None:
            updates["latency_p50_ms"] = latency_p50_ms
        if latency_p99_ms is not None:
            updates["latency_p99_ms"] = latency_p99_ms

        return self.update_model(internal_id, **updates)


class DeploymentManager:
    """
    Manages model deployments and rollbacks.

    Handles:
    - Promoting models through lifecycle stages
    - Canary deployments with traffic splitting
    - Rollback to previous versions
    """

    def __init__(self, registry: ModelRegistry | None = None):
        """
        Initialize deployment manager.

        Args:
            registry: ModelRegistry instance
        """
        self.registry = registry or ModelRegistry()

    async def promote_to_canary(
        self,
        internal_id: str,
        traffic_percentage: float = 10.0,
    ) -> ModelVersion:
        """
        Promote a model to canary deployment.

        Args:
            internal_id: Model internal ID
            traffic_percentage: Percentage of traffic to route (1-50)

        Returns:
            Updated ModelVersion
        """
        model = self.registry.get(internal_id)
        if not model:
            raise ValueError(f"Model not found: {internal_id}")

        if model.status not in ("testing",):
            raise ValueError(f"Cannot promote {model.status} model to canary")

        # Demote any existing canary for this task
        existing_canary = self.registry.get_canary_model(model.task_type)
        if existing_canary:
            self.registry.update_model(
                existing_canary.id,
                status="testing",
                traffic_percentage=0.0,
            )
            logger.info(
                "Demoted existing canary",
                model_id=existing_canary.model_id,
            )

        # Promote to canary
        traffic = max(1.0, min(50.0, traffic_percentage))
        self.registry.update_model(
            internal_id,
            status="canary",
            traffic_percentage=traffic,
            promoted_at=datetime.utcnow(),
        )

        logger.info(
            "Model promoted to canary",
            model_id=model.model_id,
            traffic_percentage=traffic,
        )

        return self.registry.get(internal_id)

    async def promote_to_production(
        self,
        internal_id: str,
    ) -> ModelVersion:
        """
        Promote a model to production.

        Args:
            internal_id: Model internal ID

        Returns:
            Updated ModelVersion
        """
        model = self.registry.get(internal_id)
        if not model:
            raise ValueError(f"Model not found: {internal_id}")

        if model.status not in ("canary", "testing"):
            raise ValueError(f"Cannot promote {model.status} model to production")

        # Deprecate existing production model
        existing_prod = self.registry.get_production_model(model.task_type)
        if existing_prod:
            self.registry.update_model(
                existing_prod.id,
                status="deprecated",
                traffic_percentage=0.0,
                deprecated_at=datetime.utcnow(),
            )
            logger.info(
                "Deprecated previous production model",
                model_id=existing_prod.model_id,
            )

        # Promote to production
        self.registry.update_model(
            internal_id,
            status="production",
            traffic_percentage=100.0,
            promoted_at=datetime.utcnow(),
        )

        logger.info(
            "Model promoted to production",
            model_id=model.model_id,
        )

        return self.registry.get(internal_id)

    async def rollback(self, task_type: TaskType) -> ModelVersion:
        """
        Rollback to the previous production model.

        Args:
            task_type: Task to rollback

        Returns:
            Restored ModelVersion
        """
        # Get deprecated models sorted by deprecation time
        deprecated = [
            m for m in self.registry.list_models(task_type=task_type, status="deprecated")
            if m.deprecated_at
        ]

        if not deprecated:
            raise ValueError(f"No previous production model found for {task_type.value}")

        # Get the most recently deprecated model
        previous = max(deprecated, key=lambda m: m.deprecated_at or datetime.min)

        # Demote current production
        current_prod = self.registry.get_production_model(task_type)
        if current_prod:
            self.registry.update_model(
                current_prod.id,
                status="deprecated",
                traffic_percentage=0.0,
                deprecated_at=datetime.utcnow(),
            )

        # Restore previous model
        self.registry.update_model(
            previous.id,
            status="production",
            traffic_percentage=100.0,
            deprecated_at=None,
            promoted_at=datetime.utcnow(),
        )

        logger.warning(
            "Rolled back to previous model",
            task_type=task_type.value,
            model_id=previous.model_id,
        )

        return self.registry.get(previous.id)

    def get_model_for_request(
        self,
        task_type: TaskType,
        organization_id: str,
    ) -> str | None:
        """
        Get the model ID to use for a request.

        Uses deterministic routing based on organization ID for
        consistent canary behavior.

        Args:
            task_type: Task type
            organization_id: Organization making the request

        Returns:
            Model ID to use, or None if no model available
        """
        production = self.registry.get_production_model(task_type)
        canary = self.registry.get_canary_model(task_type)

        if not production and not canary:
            return None

        if not canary:
            return production.model_id if production else None

        # Deterministic routing based on org_id
        # Same org always gets same model for consistency
        org_hash = int(hashlib.md5(organization_id.encode()).hexdigest(), 16)
        canary_threshold = canary.traffic_percentage

        if (org_hash % 100) < canary_threshold:
            return canary.model_id

        return production.model_id if production else canary.model_id
