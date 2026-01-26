"""
Fine-tuning schemas and data models.

Defines the data structures for:
- Task types for fine-tuning
- Training sample quality tracking
- Fine-tuning job management
- Model versioning
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskType(str, Enum):
    """Types of tasks that can be fine-tuned."""

    CLASSIFICATION = "classify"
    CLAIM_EXTRACTION = "extract_claims"
    COMMITMENT_EXTRACTION = "extract_commitments"
    DECISION_EXTRACTION = "extract_decisions"
    TASK_EXTRACTION = "extract_tasks"
    RISK_DETECTION = "detect_risks"
    BRIEF_GENERATION = "generate_brief"
    ENTITY_RESOLUTION = "entity_resolution"


class DataQuality(str, Enum):
    """Quality level of training data."""

    VERIFIED = "verified"  # Human-verified
    AUTO_ACCEPTED = "auto"  # High confidence (>0.85)
    USER_CORRECTED = "corrected"  # User made corrections (GOLD)
    PENDING = "pending"  # Needs review
    REJECTED = "rejected"  # Marked as bad data


class TrainingSample(BaseModel):
    """A single training sample for fine-tuning."""

    id: str = Field(description="Unique identifier for this sample")
    task_type: TaskType = Field(description="The task this sample is for")
    model_used: str = Field(description="Model that generated this output")
    provider_used: str = Field(description="Provider that served this request")

    # Chat format for fine-tuning
    messages: list[dict[str, str]] = Field(
        description="Chat messages in OpenAI format"
    )
    expected_output: dict[str, Any] = Field(
        description="The expected/correct output"
    )
    model_output: dict[str, Any] | None = Field(
        default=None, description="What the model actually output"
    )

    # Quality tracking
    quality: DataQuality = Field(
        default=DataQuality.PENDING, description="Quality level of this sample"
    )
    confidence_score: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Confidence score from extraction"
    )

    # Corrections (most valuable data)
    was_corrected: bool = Field(
        default=False, description="Whether a user corrected this"
    )
    correction_type: str | None = Field(
        default=None, description="Type of correction made"
    )
    corrected_by: str | None = Field(
        default=None, description="User who made the correction"
    )
    corrected_at: datetime | None = Field(
        default=None, description="When correction was made"
    )

    # Anonymization
    is_anonymized: bool = Field(
        default=False, description="Whether PII has been removed"
    )
    content_hash: str = Field(
        default="", description="Hash for deduplication"
    )

    # Metadata
    organization_id: str | None = Field(
        default=None, description="Source organization (anonymized)"
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow, description="When sample was created"
    )


class TrainingDataset(BaseModel):
    """A complete training dataset for fine-tuning."""

    task_type: TaskType = Field(description="Task this dataset is for")
    train_count: int = Field(description="Number of training samples")
    validation_count: int = Field(description="Number of validation samples")
    test_count: int = Field(description="Number of test samples")

    # Quality distribution
    verified_count: int = Field(default=0)
    auto_accepted_count: int = Field(default=0)
    user_corrected_count: int = Field(default=0)

    # Paths
    train_path: str = Field(default="")
    validation_path: str = Field(default="")
    test_path: str = Field(default="")

    created_at: datetime = Field(default_factory=datetime.utcnow)


class FineTuningJob(BaseModel):
    """A fine-tuning job record."""

    id: str = Field(description="Internal job ID")
    task_type: TaskType = Field(description="Task being fine-tuned")
    base_model: str = Field(description="Base model being fine-tuned")
    provider: str = Field(description="Provider running the job")

    # Job status
    status: str = Field(
        default="pending",
        description="Job status: pending, running, completed, failed, cancelled",
    )
    provider_job_id: str = Field(
        default="", description="Provider's job ID"
    )

    # Training configuration
    training_samples: int = Field(default=0)
    validation_samples: int = Field(default=0)
    epochs: int = Field(default=3)
    learning_rate: float = Field(default=1e-5)
    batch_size: int = Field(default=4)

    # LoRA configuration
    lora_enabled: bool = Field(default=True)
    lora_rank: int = Field(default=16)
    lora_alpha: int = Field(default=32)
    lora_dropout: float = Field(default=0.05)

    # Results
    output_model_id: str | None = Field(
        default=None, description="ID of the fine-tuned model"
    )
    training_loss: float | None = Field(default=None)
    validation_loss: float | None = Field(default=None)

    # Timing
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = Field(default=None)
    completed_at: datetime | None = Field(default=None)

    # Cost tracking
    estimated_cost_usd: float | None = Field(default=None)
    actual_cost_usd: float | None = Field(default=None)


class ModelVersion(BaseModel):
    """A versioned fine-tuned model."""

    id: str = Field(description="Internal version ID")
    task_type: TaskType = Field(description="Task this model is for")
    model_id: str = Field(description="Provider model ID")
    base_model: str = Field(description="Base model it was fine-tuned from")
    provider: str = Field(description="Provider hosting the model")

    # Version info
    version: str = Field(description="Semantic version (e.g., '1.0.0')")
    version_suffix: str = Field(
        default="", description="Additional suffix (e.g., 'drovi-commitments')"
    )

    # Deployment status
    status: str = Field(
        default="testing",
        description="Status: testing, canary, production, deprecated",
    )
    traffic_percentage: float = Field(
        default=0.0, ge=0.0, le=100.0, description="Traffic percentage for canary"
    )

    # Performance metrics
    accuracy: float | None = Field(default=None)
    precision: float | None = Field(default=None)
    recall: float | None = Field(default=None)
    f1_score: float | None = Field(default=None)
    latency_p50_ms: float | None = Field(default=None)
    latency_p99_ms: float | None = Field(default=None)

    # Metadata
    fine_tuning_job_id: str | None = Field(default=None)
    training_samples: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    promoted_at: datetime | None = Field(default=None)
    deprecated_at: datetime | None = Field(default=None)


class EvaluationResult(BaseModel):
    """Results from evaluating a model."""

    model_id: str = Field(description="Model that was evaluated")
    task_type: TaskType = Field(description="Task evaluated on")
    test_samples: int = Field(description="Number of test samples")

    # Metrics
    accuracy: float = Field(description="Overall accuracy")
    precision: float = Field(default=0.0)
    recall: float = Field(default=0.0)
    f1_score: float = Field(default=0.0)

    # Latency
    latency_p50_ms: float = Field(default=0.0)
    latency_p95_ms: float = Field(default=0.0)
    latency_p99_ms: float = Field(default=0.0)

    # Cost
    total_cost_usd: float = Field(default=0.0)
    cost_per_sample_usd: float = Field(default=0.0)

    # Details
    errors: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ModelComparison(BaseModel):
    """Comparison between two models."""

    model_a: str = Field(description="First model ID")
    model_b: str = Field(description="Second model ID")
    task_type: TaskType = Field(description="Task compared on")
    test_samples: int = Field(description="Number of samples compared")

    # Results
    model_a_metrics: EvaluationResult = Field(description="Model A metrics")
    model_b_metrics: EvaluationResult = Field(description="Model B metrics")

    # Comparison
    winner: str = Field(description="Which model won")
    accuracy_improvement: float = Field(description="Improvement in accuracy")
    f1_improvement: float = Field(default=0.0)
    latency_improvement_ms: float = Field(default=0.0)

    created_at: datetime = Field(default_factory=datetime.utcnow)
