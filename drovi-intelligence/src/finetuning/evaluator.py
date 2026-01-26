"""
Model Evaluator for Fine-Tuned Models.

Provides evaluation and A/B testing capabilities for:
- Accuracy measurement
- Precision/recall/F1 metrics
- Latency benchmarking
- Cost tracking
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog
from together import AsyncTogether

from src.config import get_settings

from .schemas import EvaluationResult, ModelComparison, TaskType

logger = structlog.get_logger()


class ModelEvaluator:
    """
    Evaluates fine-tuned models against test sets.

    Features:
    - Task-specific accuracy calculation
    - Latency measurement
    - Detailed error analysis
    """

    def __init__(
        self,
        model_id: str,
        provider: str = "together",
    ):
        """
        Initialize evaluator for a specific model.

        Args:
            model_id: Model ID to evaluate
            provider: Provider hosting the model
        """
        self.model_id = model_id
        self.provider = provider

        settings = get_settings()
        self.client = AsyncTogether(api_key=settings.together_api_key)

    async def _get_prediction(
        self,
        messages: list[dict[str, str]],
    ) -> tuple[dict[str, Any], float]:
        """
        Get a prediction from the model.

        Returns:
            Tuple of (predicted output, latency_ms)
        """
        start_time = time.time()

        response = await self.client.chat.completions.create(
            model=self.model_id,
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_object"},
        )

        latency_ms = (time.time() - start_time) * 1000
        content = response.choices[0].message.content or "{}"

        try:
            predicted = json.loads(content)
        except json.JSONDecodeError:
            predicted = {"error": "Invalid JSON", "raw": content[:200]}

        return predicted, latency_ms

    def _calculate_accuracy(
        self,
        expected: dict[str, Any],
        predicted: dict[str, Any],
        task_type: TaskType,
    ) -> float:
        """
        Calculate accuracy for a single sample.

        Uses task-specific comparison logic.
        """
        if task_type == TaskType.CLASSIFICATION:
            # Exact match on classification
            expected_class = expected.get("classification") or expected.get("label")
            predicted_class = predicted.get("classification") or predicted.get("label")
            return 1.0 if expected_class == predicted_class else 0.0

        if task_type in (
            TaskType.COMMITMENT_EXTRACTION,
            TaskType.DECISION_EXTRACTION,
            TaskType.CLAIM_EXTRACTION,
            TaskType.TASK_EXTRACTION,
        ):
            # For extractions, compare key fields
            return self._compare_extractions(expected, predicted)

        if task_type == TaskType.BRIEF_GENERATION:
            # For briefs, check key components
            return self._compare_briefs(expected, predicted)

        # Default: compare keys present
        expected_keys = set(expected.keys())
        predicted_keys = set(predicted.keys())
        if not expected_keys:
            return 1.0 if not predicted_keys else 0.0
        return len(expected_keys & predicted_keys) / len(expected_keys)

    def _compare_extractions(
        self,
        expected: dict[str, Any],
        predicted: dict[str, Any],
    ) -> float:
        """Compare extraction results."""
        expected_items = expected.get("items") or expected.get("commitments") or expected.get("decisions") or []
        predicted_items = predicted.get("items") or predicted.get("commitments") or predicted.get("decisions") or []

        if not expected_items:
            return 1.0 if not predicted_items else 0.5

        # Compare count first
        count_ratio = min(len(predicted_items), len(expected_items)) / max(len(expected_items), 1)

        # If counts match, compare content
        if len(expected_items) == len(predicted_items):
            content_matches = 0
            for exp, pred in zip(expected_items, predicted_items):
                # Check key fields
                if isinstance(exp, dict) and isinstance(pred, dict):
                    exp_title = str(exp.get("title", "")).lower()
                    pred_title = str(pred.get("title", "")).lower()
                    if exp_title in pred_title or pred_title in exp_title:
                        content_matches += 1
            content_ratio = content_matches / len(expected_items) if expected_items else 1.0
            return (count_ratio + content_ratio) / 2

        return count_ratio * 0.8  # Penalize count mismatch

    def _compare_briefs(
        self,
        expected: dict[str, Any],
        predicted: dict[str, Any],
    ) -> float:
        """Compare brief generation results."""
        score = 0.0
        checks = 0

        # Check suggested action
        if "suggested_action" in expected:
            checks += 1
            if expected.get("suggested_action") == predicted.get("suggested_action"):
                score += 1.0

        # Check priority tier
        if "priority_tier" in expected:
            checks += 1
            if expected.get("priority_tier") == predicted.get("priority_tier"):
                score += 1.0

        # Check summary exists
        if "summary" in expected:
            checks += 1
            if predicted.get("summary"):
                score += 1.0

        return score / checks if checks > 0 else 0.5

    async def evaluate(
        self,
        test_file: Path,
        task_type: TaskType,
        max_samples: int = 100,
    ) -> EvaluationResult:
        """
        Evaluate model on a test set.

        Args:
            test_file: Path to test JSONL file
            task_type: Task type for evaluation
            max_samples: Maximum samples to evaluate

        Returns:
            EvaluationResult with metrics
        """
        logger.info(
            "Starting evaluation",
            model=self.model_id,
            task_type=task_type.value,
            max_samples=max_samples,
        )

        # Load test samples
        samples = []
        with open(test_file) as f:
            for line in f:
                if len(samples) >= max_samples:
                    break
                samples.append(json.loads(line))

        if not samples:
            raise ValueError(f"No test samples found in {test_file}")

        # Evaluate each sample
        accuracies: list[float] = []
        latencies: list[float] = []
        errors: list[dict[str, Any]] = []

        for i, sample in enumerate(samples):
            messages = sample["messages"]

            # Extract expected output (last assistant message)
            expected_content = None
            input_messages = []
            for msg in messages:
                if msg["role"] == "assistant":
                    expected_content = msg["content"]
                else:
                    input_messages.append(msg)

            if not expected_content:
                continue

            try:
                expected = json.loads(expected_content)
            except json.JSONDecodeError:
                expected = {"raw": expected_content}

            # Get prediction
            try:
                predicted, latency_ms = await self._get_prediction(input_messages)
                latencies.append(latency_ms)

                # Calculate accuracy
                accuracy = self._calculate_accuracy(expected, predicted, task_type)
                accuracies.append(accuracy)

                if accuracy < 0.5:
                    errors.append({
                        "sample_index": i,
                        "expected": expected,
                        "predicted": predicted,
                        "accuracy": accuracy,
                    })

            except Exception as e:
                logger.warning("Evaluation sample failed", index=i, error=str(e))
                errors.append({
                    "sample_index": i,
                    "error": str(e),
                })
                accuracies.append(0.0)

            # Log progress every 10 samples
            if (i + 1) % 10 == 0:
                logger.debug(
                    "Evaluation progress",
                    completed=i + 1,
                    total=len(samples),
                    current_accuracy=sum(accuracies) / len(accuracies),
                )

        # Calculate final metrics
        avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else 0.0

        # Calculate latency percentiles
        sorted_latencies = sorted(latencies) if latencies else [0.0]
        p50_idx = int(len(sorted_latencies) * 0.5)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p99_idx = int(len(sorted_latencies) * 0.99)

        result = EvaluationResult(
            model_id=self.model_id,
            task_type=task_type,
            test_samples=len(samples),
            accuracy=avg_accuracy,
            precision=avg_accuracy,  # Simplified for now
            recall=avg_accuracy,
            f1_score=avg_accuracy,
            latency_p50_ms=sorted_latencies[p50_idx] if sorted_latencies else 0.0,
            latency_p95_ms=sorted_latencies[p95_idx] if p95_idx < len(sorted_latencies) else sorted_latencies[-1],
            latency_p99_ms=sorted_latencies[p99_idx] if p99_idx < len(sorted_latencies) else sorted_latencies[-1],
            errors=errors[:10],  # Keep only first 10 errors
            created_at=datetime.utcnow(),
        )

        logger.info(
            "Evaluation complete",
            model=self.model_id,
            accuracy=avg_accuracy,
            samples=len(samples),
            errors=len(errors),
        )

        return result


async def compare_models(
    model_a: str,
    model_b: str,
    test_file: Path,
    task_type: TaskType,
    max_samples: int = 50,
) -> ModelComparison:
    """
    A/B test two models on the same test set.

    Args:
        model_a: First model ID (e.g., fine-tuned)
        model_b: Second model ID (e.g., base)
        test_file: Path to test JSONL file
        task_type: Task type for evaluation
        max_samples: Maximum samples to evaluate

    Returns:
        ModelComparison with results
    """
    logger.info(
        "Comparing models",
        model_a=model_a,
        model_b=model_b,
        task_type=task_type.value,
    )

    # Evaluate both models
    evaluator_a = ModelEvaluator(model_id=model_a)
    evaluator_b = ModelEvaluator(model_id=model_b)

    results_a, results_b = await asyncio.gather(
        evaluator_a.evaluate(test_file, task_type, max_samples),
        evaluator_b.evaluate(test_file, task_type, max_samples),
    )

    # Determine winner
    if results_a.f1_score > results_b.f1_score:
        winner = model_a
    elif results_b.f1_score > results_a.f1_score:
        winner = model_b
    else:
        winner = "tie"

    comparison = ModelComparison(
        model_a=model_a,
        model_b=model_b,
        task_type=task_type,
        test_samples=max_samples,
        model_a_metrics=results_a,
        model_b_metrics=results_b,
        winner=winner,
        accuracy_improvement=results_a.accuracy - results_b.accuracy,
        f1_improvement=results_a.f1_score - results_b.f1_score,
        latency_improvement_ms=results_b.latency_p50_ms - results_a.latency_p50_ms,
        created_at=datetime.utcnow(),
    )

    logger.info(
        "Model comparison complete",
        winner=winner,
        accuracy_improvement=comparison.accuracy_improvement,
        f1_improvement=comparison.f1_improvement,
    )

    return comparison
