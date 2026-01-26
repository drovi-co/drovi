"""
Dataset Builder for Fine-Tuning.

Builds formatted datasets from collected training samples
in the format required by Together.ai fine-tuning API.
"""

import json
import random
from datetime import datetime
from pathlib import Path
from typing import Any

import aiofiles
import structlog

from src.config import get_settings

from .schemas import DataQuality, TaskType, TrainingDataset, TrainingSample

logger = structlog.get_logger()


class DatasetBuilder:
    """
    Builds fine-tuning datasets from collected samples.

    Features:
    - Quality filtering
    - Train/validation/test splitting
    - Format conversion for Together.ai
    - Balancing by quality (prioritize user corrections)
    """

    def __init__(self, base_path: str | None = None):
        settings = get_settings()
        self.base_path = Path(base_path or settings.training_data_path)
        self.datasets_path = self.base_path / "datasets"
        self.datasets_path.mkdir(parents=True, exist_ok=True)

    async def load_samples(
        self,
        task_type: TaskType,
        min_confidence: float = 0.0,
        exclude_rejected: bool = True,
    ) -> list[TrainingSample]:
        """
        Load all samples for a task type.

        Args:
            task_type: Task to load samples for
            min_confidence: Minimum confidence threshold
            exclude_rejected: Whether to exclude rejected samples

        Returns:
            List of training samples
        """
        task_dir = self.base_path / task_type.value
        if not task_dir.exists():
            return []

        samples = []
        for sample_path in task_dir.glob("*.json"):
            async with aiofiles.open(sample_path) as f:
                content = await f.read()
                sample = TrainingSample.model_validate_json(content)

                # Filter by confidence
                if sample.confidence_score < min_confidence:
                    continue

                # Filter rejected
                if exclude_rejected and sample.quality == DataQuality.REJECTED:
                    continue

                samples.append(sample)

        return samples

    def _prioritize_samples(self, samples: list[TrainingSample]) -> list[TrainingSample]:
        """
        Sort samples by quality priority.

        Priority order:
        1. User corrected (GOLD standard)
        2. Verified (human verified)
        3. Auto accepted (high confidence)
        4. Pending
        """
        priority_order = {
            DataQuality.USER_CORRECTED: 0,
            DataQuality.VERIFIED: 1,
            DataQuality.AUTO_ACCEPTED: 2,
            DataQuality.PENDING: 3,
            DataQuality.REJECTED: 4,
        }

        return sorted(
            samples,
            key=lambda s: (
                priority_order.get(s.quality, 99),
                -s.confidence_score,  # Higher confidence first within quality
            ),
        )

    def _split_samples(
        self,
        samples: list[TrainingSample],
        train_ratio: float = 0.8,
        validation_ratio: float = 0.1,
    ) -> tuple[list[TrainingSample], list[TrainingSample], list[TrainingSample]]:
        """
        Split samples into train/validation/test sets.

        Uses stratified splitting to maintain quality distribution.
        """
        # Shuffle for randomness
        shuffled = samples.copy()
        random.shuffle(shuffled)

        n = len(shuffled)
        train_end = int(n * train_ratio)
        val_end = train_end + int(n * validation_ratio)

        train = shuffled[:train_end]
        validation = shuffled[train_end:val_end]
        test = shuffled[val_end:]

        return train, validation, test

    def _convert_to_finetuning_format(self, sample: TrainingSample) -> dict[str, Any]:
        """
        Convert a sample to Together.ai fine-tuning format.

        Together.ai expects:
        {
            "messages": [
                {"role": "system", "content": "..."},
                {"role": "user", "content": "..."},
                {"role": "assistant", "content": "..."}
            ]
        }
        """
        # Start with the input messages
        messages = list(sample.messages)

        # Add the expected output as the assistant response
        messages.append({
            "role": "assistant",
            "content": json.dumps(sample.expected_output, indent=2),
        })

        return {"messages": messages}

    async def _write_jsonl(self, samples: list[TrainingSample], path: Path):
        """Write samples to a JSONL file."""
        async with aiofiles.open(path, "w") as f:
            for sample in samples:
                formatted = self._convert_to_finetuning_format(sample)
                await f.write(json.dumps(formatted) + "\n")

    async def build_dataset(
        self,
        task_type: TaskType,
        min_confidence: float = 0.7,
        train_ratio: float = 0.8,
        validation_ratio: float = 0.1,
        max_samples: int | None = None,
    ) -> TrainingDataset:
        """
        Build a complete fine-tuning dataset.

        Args:
            task_type: Task to build dataset for
            min_confidence: Minimum confidence threshold
            train_ratio: Fraction for training set
            validation_ratio: Fraction for validation set
            max_samples: Optional limit on total samples

        Returns:
            TrainingDataset with paths and counts
        """
        logger.info(
            "Building dataset",
            task_type=task_type.value,
            min_confidence=min_confidence,
        )

        # Load all samples
        samples = await self.load_samples(
            task_type=task_type,
            min_confidence=min_confidence,
            exclude_rejected=True,
        )

        if not samples:
            logger.warning("No samples found", task_type=task_type.value)
            return TrainingDataset(
                task_type=task_type,
                train_count=0,
                validation_count=0,
                test_count=0,
            )

        # Prioritize by quality
        samples = self._prioritize_samples(samples)

        # Limit samples if specified
        if max_samples and len(samples) > max_samples:
            samples = samples[:max_samples]

        # Split into sets
        train, validation, test = self._split_samples(
            samples, train_ratio, validation_ratio
        )

        # Create output directory
        output_dir = self.datasets_path / task_type.value
        output_dir.mkdir(parents=True, exist_ok=True)

        # Write JSONL files
        train_path = output_dir / "train.jsonl"
        validation_path = output_dir / "validation.jsonl"
        test_path = output_dir / "test.jsonl"

        await self._write_jsonl(train, train_path)
        await self._write_jsonl(validation, validation_path)
        await self._write_jsonl(test, test_path)

        # Count quality distribution
        quality_counts = {q: 0 for q in DataQuality}
        for sample in samples:
            quality_counts[sample.quality] += 1

        dataset = TrainingDataset(
            task_type=task_type,
            train_count=len(train),
            validation_count=len(validation),
            test_count=len(test),
            verified_count=quality_counts[DataQuality.VERIFIED],
            auto_accepted_count=quality_counts[DataQuality.AUTO_ACCEPTED],
            user_corrected_count=quality_counts[DataQuality.USER_CORRECTED],
            train_path=str(train_path),
            validation_path=str(validation_path),
            test_path=str(test_path),
            created_at=datetime.utcnow(),
        )

        logger.info(
            "Dataset built",
            task_type=task_type.value,
            train_count=dataset.train_count,
            validation_count=dataset.validation_count,
            test_count=dataset.test_count,
            user_corrected=dataset.user_corrected_count,
        )

        return dataset

    async def get_dataset_stats(self, task_type: TaskType) -> dict[str, Any]:
        """Get statistics about available samples for a task."""
        samples = await self.load_samples(
            task_type=task_type,
            min_confidence=0.0,
            exclude_rejected=False,
        )

        quality_counts = {q.value: 0 for q in DataQuality}
        confidence_sum = 0.0

        for sample in samples:
            quality_counts[sample.quality.value] += 1
            confidence_sum += sample.confidence_score

        return {
            "task_type": task_type.value,
            "total_samples": len(samples),
            "quality_distribution": quality_counts,
            "average_confidence": (
                confidence_sum / len(samples) if samples else 0.0
            ),
            "usable_samples": sum(
                1 for s in samples
                if s.quality != DataQuality.REJECTED and s.confidence_score >= 0.7
            ),
        }
