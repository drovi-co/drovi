"""
Calibration Service

Implements DiBello's Strategic Rehearsal for confidence calibration:
- Track predictions vs outcomes
- Calculate Brier scores for reliability, resolution, uncertainty
- Adjust raw LLM confidence based on historical accuracy

From the "Trillion Dollar Hole" research:
- LLM confidence scores are uncalibrated
- Need predict → feedback → update cycle
- Measure calibration to know when to trust predictions
"""

import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class PredictionType(str, Enum):
    """Types of predictions we track."""

    COMMITMENT_FULFILLED = "commitment_fulfilled"
    COMMITMENT_OVERDUE = "commitment_overdue"
    DECISION_REVERSED = "decision_reversed"
    DECISION_CONTESTED = "decision_contested"
    RISK_MATERIALIZED = "risk_materialized"
    TASK_COMPLETED_ON_TIME = "task_completed_on_time"
    CONTACT_RESPONSE_TIME = "contact_response_time"
    TOPIC_EMERGENCE = "topic_emergence"


class OutcomeStatus(str, Enum):
    """Status of prediction outcomes."""

    PENDING = "pending"
    CONFIRMED = "confirmed"
    DISCONFIRMED = "disconfirmed"
    INCONCLUSIVE = "inconclusive"
    EXPIRED = "expired"


class Prediction(BaseModel):
    """A recorded prediction."""

    id: str
    organization_id: str
    uio_id: str | None = None

    prediction_type: PredictionType
    predicted_outcome: dict[str, Any]
    confidence: float  # 0-1

    predicted_at: datetime
    evaluate_by: datetime | None = None

    actual_outcome: dict[str, Any] | None = None
    outcome_status: OutcomeStatus = OutcomeStatus.PENDING
    outcome_recorded_at: datetime | None = None
    outcome_source: str | None = None

    calibration_error: float | None = None
    brier_score: float | None = None

    model_used: str | None = None
    extraction_context: dict[str, Any] | None = None


class CalibrationMetrics(BaseModel):
    """Calibration metrics for a set of predictions."""

    # Sample size
    total_predictions: int = 0
    resolved_predictions: int = 0

    # Brier score decomposition
    brier_score: float = 0.0  # Overall Brier score (lower is better)
    reliability: float = 0.0  # How well calibrated (0 = perfect)
    resolution: float = 0.0  # Discriminative ability (higher is better)
    uncertainty: float = 0.0  # Base rate uncertainty

    # Calibration curve data
    calibration_buckets: list[dict] = Field(default_factory=list)
    # [{bucket: 0.1, predicted: 0.1, actual: 0.15, count: 50}, ...]

    # Confidence adjustment
    adjustment_factor: float = 1.0  # Multiply raw confidence by this


class CalibrationService:
    """
    Service for tracking predictions and computing calibration metrics.

    From DiBello's Strategic Rehearsal:
    - Experts improve by making predictions and getting feedback
    - Calibration shows how trustworthy confidence scores are
    - Well-calibrated: 80% confidence → 80% accuracy
    """

    def __init__(self, db_session=None):
        """
        Initialize calibration service.

        Args:
            db_session: Optional SQLAlchemy session for PostgreSQL
        """
        self._db = db_session

    async def _ensure_db(self):
        """Lazy-load database connection."""
        if self._db is None:
            # Import and create session
            pass  # Will be connected via dependency injection

    async def record_prediction(
        self,
        organization_id: str,
        prediction_type: PredictionType,
        predicted_outcome: dict[str, Any],
        confidence: float,
        uio_id: str | None = None,
        evaluate_by: datetime | None = None,
        model_used: str | None = None,
        extraction_context: dict[str, Any] | None = None,
    ) -> Prediction:
        """
        Record a new prediction for future calibration.

        Args:
            organization_id: Organization context
            prediction_type: Type of prediction
            predicted_outcome: What we're predicting
            confidence: Confidence level (0-1)
            uio_id: Optional link to UIO
            evaluate_by: When to check outcome
            model_used: Model that made prediction
            extraction_context: Additional context

        Returns:
            Created Prediction object
        """
        prediction = Prediction(
            id=str(uuid4()),
            organization_id=organization_id,
            uio_id=uio_id,
            prediction_type=prediction_type,
            predicted_outcome=predicted_outcome,
            confidence=min(1.0, max(0.0, confidence)),  # Clamp to [0, 1]
            predicted_at=datetime.now(timezone.utc),
            evaluate_by=evaluate_by,
            model_used=model_used,
            extraction_context=extraction_context,
        )

        # Store in database
        await self._store_prediction(prediction)

        logger.info(
            "Prediction recorded",
            prediction_id=prediction.id,
            prediction_type=prediction_type,
            confidence=confidence,
        )

        return prediction

    async def record_outcome(
        self,
        prediction_id: str,
        was_correct: bool,
        actual_outcome: dict[str, Any] | None = None,
        source: str = "detected",
    ) -> Prediction | None:
        """
        Record the actual outcome for a prediction.

        Args:
            prediction_id: ID of the prediction
            was_correct: Whether prediction was correct
            actual_outcome: Actual outcome details
            source: How outcome was determined

        Returns:
            Updated Prediction or None if not found
        """
        prediction = await self._get_prediction(prediction_id)
        if not prediction:
            logger.warning("Prediction not found", prediction_id=prediction_id)
            return None

        # Update outcome
        prediction.actual_outcome = actual_outcome or {"matched": was_correct}
        prediction.outcome_status = (
            OutcomeStatus.CONFIRMED if was_correct else OutcomeStatus.DISCONFIRMED
        )
        prediction.outcome_recorded_at = datetime.now(timezone.utc)
        prediction.outcome_source = source

        # Calculate calibration error and Brier score
        actual_value = 1.0 if was_correct else 0.0
        prediction.calibration_error = abs(prediction.confidence - actual_value)
        prediction.brier_score = (prediction.confidence - actual_value) ** 2

        # Update in database
        await self._update_prediction(prediction)

        logger.info(
            "Outcome recorded",
            prediction_id=prediction_id,
            was_correct=was_correct,
            calibration_error=prediction.calibration_error,
            brier_score=prediction.brier_score,
        )

        return prediction

    async def get_calibration_metrics(
        self,
        organization_id: str,
        prediction_type: PredictionType | None = None,
        days: int = 90,
    ) -> CalibrationMetrics:
        """
        Calculate calibration metrics for an organization.

        Uses Brier score decomposition:
        - Reliability: How well predictions match outcomes at each confidence level
        - Resolution: How much predictions discriminate between outcomes
        - Uncertainty: Baseline uncertainty from outcome base rates

        Args:
            organization_id: Organization to analyze
            prediction_type: Optional filter by type
            days: Look back period

        Returns:
            CalibrationMetrics with Brier decomposition
        """
        # Get resolved predictions
        predictions = await self._get_resolved_predictions(
            organization_id=organization_id,
            prediction_type=prediction_type,
            days=days,
        )

        if not predictions:
            return CalibrationMetrics()

        # Calculate metrics
        total = len(predictions)
        resolved = len([p for p in predictions if p.brier_score is not None])

        if resolved == 0:
            return CalibrationMetrics(
                total_predictions=total,
                resolved_predictions=0,
            )

        # Brier score (mean squared error)
        brier_scores = [p.brier_score for p in predictions if p.brier_score is not None]
        mean_brier = sum(brier_scores) / len(brier_scores)

        # Build calibration buckets (10 buckets: 0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
        buckets = self._build_calibration_buckets(predictions)

        # Brier decomposition
        reliability, resolution, uncertainty = self._brier_decomposition(
            predictions, buckets
        )

        # Calculate adjustment factor based on calibration
        adjustment = self._calculate_adjustment_factor(buckets)

        return CalibrationMetrics(
            total_predictions=total,
            resolved_predictions=resolved,
            brier_score=mean_brier,
            reliability=reliability,
            resolution=resolution,
            uncertainty=uncertainty,
            calibration_buckets=buckets,
            adjustment_factor=adjustment,
        )

    async def get_adjusted_confidence(
        self,
        raw_confidence: float,
        organization_id: str,
        prediction_type: PredictionType | None = None,
    ) -> float:
        """
        Adjust raw LLM confidence based on historical calibration.

        If the model tends to be overconfident (e.g., says 80% but only
        60% accuracy), we adjust down. If underconfident, adjust up.

        Args:
            raw_confidence: Raw confidence from LLM
            organization_id: Organization context
            prediction_type: Optional type for type-specific adjustment

        Returns:
            Adjusted confidence (0-1)
        """
        metrics = await self.get_calibration_metrics(
            organization_id=organization_id,
            prediction_type=prediction_type,
            days=90,
        )

        # If insufficient data, return raw confidence
        if metrics.resolved_predictions < 10:
            return raw_confidence

        # Apply adjustment factor
        adjusted = raw_confidence * metrics.adjustment_factor

        # Clamp to [0.05, 0.95] - never be 100% certain
        return min(0.95, max(0.05, adjusted))

    def _build_calibration_buckets(
        self, predictions: list[Prediction]
    ) -> list[dict]:
        """Build calibration curve buckets."""
        buckets = []

        for i in range(10):
            lower = i * 0.1
            upper = (i + 1) * 0.1

            bucket_preds = [
                p for p in predictions
                if p.brier_score is not None and lower <= p.confidence < upper
            ]

            if bucket_preds:
                predicted_mean = sum(p.confidence for p in bucket_preds) / len(bucket_preds)
                actual_mean = sum(
                    1.0 if p.outcome_status == OutcomeStatus.CONFIRMED else 0.0
                    for p in bucket_preds
                ) / len(bucket_preds)

                buckets.append({
                    "bucket": (lower + upper) / 2,
                    "predicted": predicted_mean,
                    "actual": actual_mean,
                    "count": len(bucket_preds),
                })

        return buckets

    def _brier_decomposition(
        self,
        predictions: list[Prediction],
        buckets: list[dict],
    ) -> tuple[float, float, float]:
        """
        Decompose Brier score into reliability, resolution, uncertainty.

        Brier = Reliability - Resolution + Uncertainty

        Reliability: Σ(n_k/N) * (f_k - o_k)^2 - measures calibration
        Resolution: Σ(n_k/N) * (o_k - o_bar)^2 - measures discrimination
        Uncertainty: o_bar * (1 - o_bar) - base rate uncertainty
        """
        n = len([p for p in predictions if p.brier_score is not None])
        if n == 0:
            return 0.0, 0.0, 0.0

        # Overall base rate
        o_bar = sum(
            1.0 if p.outcome_status == OutcomeStatus.CONFIRMED else 0.0
            for p in predictions if p.brier_score is not None
        ) / n

        # Uncertainty
        uncertainty = o_bar * (1 - o_bar)

        # Reliability and resolution from buckets
        reliability = 0.0
        resolution = 0.0

        for bucket in buckets:
            n_k = bucket["count"]
            f_k = bucket["predicted"]
            o_k = bucket["actual"]

            weight = n_k / n

            reliability += weight * (f_k - o_k) ** 2
            resolution += weight * (o_k - o_bar) ** 2

        return reliability, resolution, uncertainty

    def _calculate_adjustment_factor(self, buckets: list[dict]) -> float:
        """
        Calculate adjustment factor based on calibration curve.

        If predictions are systematically overconfident, factor < 1.
        If underconfident, factor > 1.
        """
        if not buckets:
            return 1.0

        # Weight by bucket count
        total_count = sum(b["count"] for b in buckets)
        if total_count == 0:
            return 1.0

        # Calculate weighted average of actual/predicted ratios
        weighted_ratio = sum(
            (b["actual"] / max(0.01, b["predicted"])) * b["count"]
            for b in buckets
        ) / total_count

        # Clamp to reasonable range [0.5, 1.5]
        return min(1.5, max(0.5, weighted_ratio))

    async def _store_prediction(self, prediction: Prediction) -> None:
        """Store prediction in PostgreSQL."""
        # This would use the db session to insert
        # For now, this is a placeholder
        pass

    async def _update_prediction(self, prediction: Prediction) -> None:
        """Update prediction in PostgreSQL."""
        pass

    async def _get_prediction(self, prediction_id: str) -> Prediction | None:
        """Get prediction by ID."""
        pass

    async def _get_resolved_predictions(
        self,
        organization_id: str,
        prediction_type: PredictionType | None,
        days: int,
    ) -> list[Prediction]:
        """Get resolved predictions for calibration analysis."""
        return []


# Singleton instance
_calibration_service: CalibrationService | None = None


async def get_calibration_service() -> CalibrationService:
    """Get or create the calibration service."""
    global _calibration_service
    if _calibration_service is None:
        _calibration_service = CalibrationService()
    return _calibration_service


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def calculate_brier_score(confidence: float, was_correct: bool) -> float:
    """
    Calculate Brier score for a single prediction.

    Brier score = (predicted probability - actual outcome)^2

    Args:
        confidence: Predicted probability (0-1)
        was_correct: Whether prediction was correct (0 or 1)

    Returns:
        Brier score (0-1, lower is better)
    """
    actual = 1.0 if was_correct else 0.0
    return (confidence - actual) ** 2


def interpret_calibration(metrics: CalibrationMetrics) -> str:
    """
    Generate human-readable interpretation of calibration metrics.

    Args:
        metrics: Calibration metrics to interpret

    Returns:
        Human-readable interpretation
    """
    if metrics.resolved_predictions < 10:
        return "Insufficient data for calibration analysis (need at least 10 resolved predictions)"

    interpretations = []

    # Brier score interpretation
    if metrics.brier_score < 0.1:
        interpretations.append("Excellent prediction accuracy")
    elif metrics.brier_score < 0.2:
        interpretations.append("Good prediction accuracy")
    elif metrics.brier_score < 0.3:
        interpretations.append("Fair prediction accuracy")
    else:
        interpretations.append("Poor prediction accuracy - consider recalibration")

    # Reliability interpretation
    if metrics.reliability < 0.02:
        interpretations.append("Well-calibrated confidence scores")
    elif metrics.reliability < 0.05:
        interpretations.append("Reasonably calibrated confidence scores")
    else:
        interpretations.append("Confidence scores need recalibration")

    # Resolution interpretation
    if metrics.resolution > 0.1:
        interpretations.append("Good discrimination between outcomes")
    elif metrics.resolution > 0.05:
        interpretations.append("Moderate discrimination between outcomes")
    else:
        interpretations.append("Low discrimination - predictions may not be useful")

    # Adjustment factor
    if metrics.adjustment_factor < 0.8:
        interpretations.append(
            f"Model is overconfident - adjust confidence down by {int((1-metrics.adjustment_factor)*100)}%"
        )
    elif metrics.adjustment_factor > 1.2:
        interpretations.append(
            f"Model is underconfident - adjust confidence up by {int((metrics.adjustment_factor-1)*100)}%"
        )
    else:
        interpretations.append("Confidence levels are well-calibrated")

    return ". ".join(interpretations)
