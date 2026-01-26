"""
Fine-tuning module for Drovi Intelligence models.

This module provides:
- Training data collection from production traffic
- PII anonymization for safe training data
- Dataset building and formatting
- Together.ai fine-tuning integration
- Model evaluation and A/B testing
- Model registry and deployment management
"""

from .anonymizer import PIIAnonymizer
from .collector import TrainingDataCollector
from .dataset_builder import DatasetBuilder
from .evaluator import ModelEvaluator, compare_models
from .registry import DeploymentManager, ModelRegistry, ModelVersion
from .schemas import (
    DataQuality,
    FineTuningJob,
    TaskType,
    TrainingDataset,
    TrainingSample,
)
from .together_client import TogetherFineTuning

__all__ = [
    # Schemas
    "TaskType",
    "DataQuality",
    "TrainingSample",
    "TrainingDataset",
    "FineTuningJob",
    "ModelVersion",
    # Core components
    "PIIAnonymizer",
    "TrainingDataCollector",
    "DatasetBuilder",
    "TogetherFineTuning",
    "ModelEvaluator",
    "compare_models",
    "ModelRegistry",
    "DeploymentManager",
]
