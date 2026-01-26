"""
Training Data Collector.

Collects training data from production traffic for fine-tuning.
Handles sampling, anonymization, and storage.
"""

import json
import random
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import aiofiles
import structlog

from src.config import get_settings

from .anonymizer import PIIAnonymizer, get_anonymizer
from .schemas import DataQuality, TaskType, TrainingSample

logger = structlog.get_logger()


class TrainingDataCollector:
    """
    Collects training data from production traffic.

    Features:
    - Configurable sampling rate
    - PII anonymization
    - Deduplication via content hashing
    - Quality tracking based on confidence
    """

    def __init__(
        self,
        base_path: str | None = None,
        sample_rate: float | None = None,
    ):
        settings = get_settings()
        self.base_path = Path(base_path or settings.training_data_path)
        self.sample_rate = sample_rate or settings.training_data_sample_rate
        self.anonymizer = get_anonymizer()
        self._seen_hashes: set[str] = set()
        self._ensure_directories()

    def _ensure_directories(self):
        """Create necessary directories."""
        for task_type in TaskType:
            task_dir = self.base_path / task_type.value
            task_dir.mkdir(parents=True, exist_ok=True)

    def _should_sample(self) -> bool:
        """Determine if this request should be sampled."""
        return random.random() < self.sample_rate

    def _get_sample_path(self, task_type: TaskType, sample_id: str) -> Path:
        """Get the path for a sample file."""
        return self.base_path / task_type.value / f"{sample_id}.json"

    async def collect(
        self,
        task_type: TaskType,
        messages: list[dict[str, str]],
        model_output: dict[str, Any],
        confidence_score: float,
        model_used: str,
        provider_used: str,
        organization_id: str | None = None,
    ) -> TrainingSample | None:
        """
        Collect a training sample from production traffic.

        Args:
            task_type: Type of extraction task
            messages: Input messages to the model
            model_output: Output from the model
            confidence_score: Confidence score from extraction
            model_used: Model ID used
            provider_used: Provider name
            organization_id: Source organization (will be hashed)

        Returns:
            TrainingSample if collected, None if skipped
        """
        settings = get_settings()

        # Check if collection is enabled
        if not settings.collect_training_data:
            return None

        # Sample based on config
        if not self._should_sample():
            return None

        # Compute content hash for deduplication
        content_for_hash = json.dumps(messages, sort_keys=True)
        content_hash = PIIAnonymizer.compute_hash(content_for_hash)

        # Skip duplicates
        if content_hash in self._seen_hashes:
            logger.debug("Skipping duplicate sample", hash=content_hash)
            return None

        self._seen_hashes.add(content_hash)

        # Anonymize content
        anon_messages = self.anonymizer.anonymize_messages(messages)
        anon_output = self.anonymizer.anonymize_output(model_output)

        # Determine quality based on confidence
        if confidence_score >= 0.85:
            quality = DataQuality.AUTO_ACCEPTED
        elif confidence_score >= 0.5:
            quality = DataQuality.PENDING
        else:
            quality = DataQuality.REJECTED

        # Create sample
        sample = TrainingSample(
            id=str(uuid.uuid4()),
            task_type=task_type,
            model_used=model_used,
            provider_used=provider_used,
            messages=anon_messages,
            expected_output=anon_output,
            model_output=anon_output,
            quality=quality,
            confidence_score=confidence_score,
            is_anonymized=True,
            content_hash=content_hash,
            organization_id=PIIAnonymizer.compute_hash(organization_id or "unknown"),
            created_at=datetime.utcnow(),
        )

        # Write to disk
        await self._write_sample(sample)

        logger.debug(
            "Training sample collected",
            task_type=task_type.value,
            quality=quality.value,
            confidence=confidence_score,
        )

        return sample

    async def collect_correction(
        self,
        original_sample_id: str,
        task_type: TaskType,
        original_messages: list[dict[str, str]],
        corrected_output: dict[str, Any],
        correction_type: str,
        corrected_by: str,
    ) -> TrainingSample:
        """
        Collect a user correction as GOLD training data.

        User corrections are the most valuable training data
        because they represent exactly what the model should output.

        Args:
            original_sample_id: ID of the original sample
            task_type: Type of extraction task
            original_messages: Original input messages
            corrected_output: User's corrected output
            correction_type: Type of correction made
            corrected_by: User ID who made the correction

        Returns:
            TrainingSample with correction data
        """
        # Anonymize
        anon_messages = self.anonymizer.anonymize_messages(original_messages)
        anon_output = self.anonymizer.anonymize_output(corrected_output)

        sample = TrainingSample(
            id=str(uuid.uuid4()),
            task_type=task_type,
            model_used="user_correction",
            provider_used="human",
            messages=anon_messages,
            expected_output=anon_output,
            model_output=None,  # We don't know what the original output was
            quality=DataQuality.USER_CORRECTED,
            confidence_score=1.0,  # Human verified
            was_corrected=True,
            correction_type=correction_type,
            corrected_by=PIIAnonymizer.compute_hash(corrected_by),
            corrected_at=datetime.utcnow(),
            is_anonymized=True,
            content_hash=PIIAnonymizer.compute_hash(json.dumps(anon_messages)),
            created_at=datetime.utcnow(),
        )

        await self._write_sample(sample)

        logger.info(
            "User correction collected",
            task_type=task_type.value,
            correction_type=correction_type,
        )

        return sample

    async def _write_sample(self, sample: TrainingSample):
        """Write a sample to disk."""
        path = self._get_sample_path(sample.task_type, sample.id)

        async with aiofiles.open(path, "w") as f:
            await f.write(sample.model_dump_json(indent=2))

    async def load_sample(self, task_type: TaskType, sample_id: str) -> TrainingSample | None:
        """Load a sample from disk."""
        path = self._get_sample_path(task_type, sample_id)

        if not path.exists():
            return None

        async with aiofiles.open(path) as f:
            content = await f.read()
            return TrainingSample.model_validate_json(content)

    def list_samples(
        self,
        task_type: TaskType,
        quality: DataQuality | None = None,
    ) -> list[Path]:
        """List all sample files for a task type."""
        task_dir = self.base_path / task_type.value

        samples = list(task_dir.glob("*.json"))

        if quality:
            # Filter by quality (would need to read files)
            # For efficiency, return all and filter at load time
            pass

        return samples

    def get_sample_counts(self) -> dict[str, dict[str, int]]:
        """Get counts of samples by task type and quality."""
        counts: dict[str, dict[str, int]] = {}

        for task_type in TaskType:
            task_dir = self.base_path / task_type.value
            if not task_dir.exists():
                continue

            samples = list(task_dir.glob("*.json"))
            counts[task_type.value] = {
                "total": len(samples),
                # Quality breakdown would require reading files
            }

        return counts


# Singleton
_collector: TrainingDataCollector | None = None


def get_collector() -> TrainingDataCollector:
    """Get the singleton collector instance."""
    global _collector
    if _collector is None:
        _collector = TrainingDataCollector()
    return _collector
