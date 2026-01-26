#!/usr/bin/env python3
"""
Fine-tuning CLI for Drovi Intelligence Models.

Uses Together.ai v2 SDK for all operations.

Usage:
  python scripts/finetune.py build-dataset --task commitments
  python scripts/finetune.py upload --task commitments
  python scripts/finetune.py train --task commitments --base-model llama4-maverick
  python scripts/finetune.py status --job-id ft-xxx
  python scripts/finetune.py evaluate --model ft:drovi-commitments-v1
  python scripts/finetune.py promote --model ft:drovi-commitments-v1 --to canary
"""

import asyncio
import sys
from pathlib import Path

import click

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.finetuning.dataset_builder import DatasetBuilder
from src.finetuning.evaluator import ModelEvaluator, compare_models
from src.finetuning.registry import DeploymentManager, ModelRegistry
from src.finetuning.schemas import TaskType
from src.finetuning.together_client import SUPPORTED_MODELS, TogetherFineTuning


@click.group()
def cli():
    """Drovi Intelligence Fine-Tuning CLI."""
    pass


@cli.command()
@click.option(
    "--task",
    required=True,
    type=click.Choice([t.value for t in TaskType]),
    help="Task type to build dataset for",
)
@click.option("--min-samples", default=500, help="Minimum samples required")
@click.option("--min-confidence", default=0.7, help="Minimum confidence threshold")
@click.option("--max-samples", default=None, type=int, help="Maximum samples to include")
def build_dataset(task, min_samples, min_confidence, max_samples):
    """Build training dataset from collected samples."""
    builder = DatasetBuilder()

    async def _build():
        # Get stats first
        stats = await builder.get_dataset_stats(TaskType(task))
        click.echo(f"\nDataset Statistics for '{task}':")
        click.echo(f"  Total samples: {stats['total_samples']}")
        click.echo(f"  Usable samples (>= {min_confidence} confidence): {stats['usable_samples']}")
        click.echo(f"  Average confidence: {stats['average_confidence']:.2%}")
        click.echo(f"  Quality distribution: {stats['quality_distribution']}")

        if stats["usable_samples"] < min_samples:
            click.echo(
                f"\nWarning: Only {stats['usable_samples']} usable samples, "
                f"need at least {min_samples}. Continue collecting data."
            )
            return

        # Build dataset
        dataset = await builder.build_dataset(
            task_type=TaskType(task),
            min_confidence=min_confidence,
            max_samples=max_samples,
        )

        click.echo(f"\nDataset built successfully:")
        click.echo(f"  Train samples: {dataset.train_count}")
        click.echo(f"  Validation samples: {dataset.validation_count}")
        click.echo(f"  Test samples: {dataset.test_count}")
        click.echo(f"  User corrections (GOLD): {dataset.user_corrected_count}")
        click.echo(f"\nOutput files:")
        click.echo(f"  Train: {dataset.train_path}")
        click.echo(f"  Validation: {dataset.validation_path}")
        click.echo(f"  Test: {dataset.test_path}")

    asyncio.run(_build())


@cli.command()
@click.option("--task", required=True, type=click.Choice([t.value for t in TaskType]))
def upload(task):
    """Upload training dataset to Together.ai."""
    from src.config import get_settings

    settings = get_settings()
    dataset_path = Path(settings.training_data_path) / "datasets" / task / "train.jsonl"

    if not dataset_path.exists():
        click.echo(f"Error: Dataset not found at {dataset_path}")
        click.echo("Run 'build-dataset' first")
        return

    client = TogetherFineTuning()
    file_id = client.upload_dataset(dataset_path)

    click.echo(f"\nDataset uploaded successfully!")
    click.echo(f"File ID: {file_id}")
    click.echo(f"\nUse this file ID to start training:")
    click.echo(f"  python scripts/finetune.py train --task {task} --file-id {file_id}")

    # Also upload validation file if exists
    validation_path = Path(settings.training_data_path) / "datasets" / task / "validation.jsonl"
    if validation_path.exists():
        val_file_id = client.upload_dataset(validation_path)
        click.echo(f"\nValidation file uploaded: {val_file_id}")
        click.echo(f"Add --validation-file-id {val_file_id} to train command")


@cli.command()
@click.option("--task", required=True, type=click.Choice([t.value for t in TaskType]))
@click.option("--file-id", required=True, help="File ID from upload command")
@click.option(
    "--base-model",
    default="llama4-maverick",
    type=click.Choice(list(SUPPORTED_MODELS.keys())),
    help="Base model to fine-tune",
)
@click.option("--epochs", default=3, help="Number of training epochs")
@click.option("--learning-rate", default=1e-5, type=float, help="Learning rate")
@click.option("--batch-size", default=4, help="Batch size")
@click.option("--lora-rank", default=16, help="LoRA rank")
@click.option("--lora-alpha", default=32, help="LoRA alpha")
@click.option("--validation-file-id", default=None, help="Validation file ID")
@click.option("--wait/--no-wait", default=False, help="Wait for completion")
def train(
    task,
    file_id,
    base_model,
    epochs,
    learning_rate,
    batch_size,
    lora_rank,
    lora_alpha,
    validation_file_id,
    wait,
):
    """Start fine-tuning job on Together.ai."""
    client = TogetherFineTuning()

    job = client.create_finetuning_job(
        training_file_id=file_id,
        task_type=TaskType(task),
        base_model=SUPPORTED_MODELS[base_model],
        n_epochs=epochs,
        learning_rate=learning_rate,
        batch_size=batch_size,
        suffix=f"drovi-{task}",
        lora=True,
        lora_r=lora_rank,
        lora_alpha=lora_alpha,
        validation_file_id=validation_file_id,
    )

    click.echo(f"\nFine-tuning job started!")
    click.echo(f"  Internal ID: {job.id}")
    click.echo(f"  Provider Job ID: {job.provider_job_id}")
    click.echo(f"  Base Model: {SUPPORTED_MODELS[base_model]}")
    click.echo(f"  Epochs: {epochs}")
    click.echo(f"  LoRA Rank: {lora_rank}")
    click.echo(f"\nMonitor at: https://api.together.ai/fine-tune/{job.provider_job_id}")

    if wait:
        click.echo("\nWaiting for completion...")
        completed_job = client.wait_for_completion(job.provider_job_id)
        if completed_job.status in ("completed", "succeeded"):
            output_model = getattr(completed_job, "output_name", None)
            click.echo(f"\nTraining completed!")
            click.echo(f"Output model: {output_model}")

            # Register model
            registry = ModelRegistry()
            version = registry.register_model(
                task_type=TaskType(task),
                model_id=output_model or job.provider_job_id,
                base_model=SUPPORTED_MODELS[base_model],
                provider="together",
                fine_tuning_job_id=job.provider_job_id,
            )
            click.echo(f"Model registered: {version.id}")
        else:
            click.echo(f"\nTraining failed: {completed_job.status}")


@cli.command()
@click.option("--job-id", required=True, help="Together.ai job ID")
def status(job_id):
    """Check fine-tuning job status."""
    client = TogetherFineTuning()
    job = client.get_job_status(job_id)

    click.echo(f"\nJob: {job.id}")
    click.echo(f"Status: {job.status}")
    click.echo(f"Model: {job.model}")

    if hasattr(job, "output_name") and job.output_name:
        click.echo(f"Output Model: {job.output_name}")


@cli.command("list-jobs")
def list_jobs():
    """List all fine-tuning jobs."""
    client = TogetherFineTuning()
    jobs = client.list_jobs()

    click.echo("\nFine-tuning Jobs:")
    click.echo("-" * 60)
    for job in jobs:
        output = getattr(job, "output_name", "pending")
        click.echo(f"  {job.id}: {job.status} ({job.model}) -> {output}")


@cli.command()
@click.option("--model", required=True, help="Fine-tuned model ID")
@click.option("--task", required=True, type=click.Choice([t.value for t in TaskType]))
@click.option("--test-samples", default=100, help="Number of test samples")
def evaluate(model, task, test_samples):
    """Evaluate a fine-tuned model against test set."""
    from src.config import get_settings

    settings = get_settings()
    test_file = Path(settings.training_data_path) / "datasets" / task / "test.jsonl"

    if not test_file.exists():
        click.echo(f"Error: Test file not found at {test_file}")
        click.echo("Run 'build-dataset' first")
        return

    async def _evaluate():
        evaluator = ModelEvaluator(model_id=model)
        metrics = await evaluator.evaluate(test_file, TaskType(task), test_samples)

        click.echo(f"\nEvaluation Results for {model}:")
        click.echo("-" * 40)
        click.echo(f"  Accuracy:    {metrics.accuracy:.2%}")
        click.echo(f"  Precision:   {metrics.precision:.2%}")
        click.echo(f"  Recall:      {metrics.recall:.2%}")
        click.echo(f"  F1 Score:    {metrics.f1_score:.2%}")
        click.echo(f"  Latency P50: {metrics.latency_p50_ms:.0f}ms")
        click.echo(f"  Latency P99: {metrics.latency_p99_ms:.0f}ms")
        click.echo(f"  Test samples: {metrics.test_samples}")
        click.echo(f"  Errors: {len(metrics.errors)}")

        # Update registry if model exists
        registry = ModelRegistry()
        model_version = registry.get_by_model_id(model)
        if model_version:
            registry.update_metrics(
                model_version.id,
                accuracy=metrics.accuracy,
                precision=metrics.precision,
                recall=metrics.recall,
                f1_score=metrics.f1_score,
                latency_p50_ms=metrics.latency_p50_ms,
                latency_p99_ms=metrics.latency_p99_ms,
            )
            click.echo(f"\nMetrics saved to registry for {model_version.id}")

    asyncio.run(_evaluate())


@cli.command()
@click.option("--model-a", required=True, help="First model (e.g., fine-tuned)")
@click.option("--model-b", required=True, help="Second model (e.g., base)")
@click.option("--task", required=True, type=click.Choice([t.value for t in TaskType]))
@click.option("--test-samples", default=50, help="Number of test samples")
def compare(model_a, model_b, task, test_samples):
    """Compare two models (A/B test)."""
    from src.config import get_settings

    settings = get_settings()
    test_file = Path(settings.training_data_path) / "datasets" / task / "test.jsonl"

    if not test_file.exists():
        click.echo(f"Error: Test file not found at {test_file}")
        return

    async def _compare():
        result = await compare_models(
            model_a, model_b, test_file, TaskType(task), test_samples
        )

        click.echo(f"\nComparison: {model_a} vs {model_b}")
        click.echo("=" * 50)
        click.echo(f"\nModel A ({model_a}):")
        click.echo(f"  Accuracy: {result.model_a_metrics.accuracy:.2%}")
        click.echo(f"  F1 Score: {result.model_a_metrics.f1_score:.2%}")
        click.echo(f"  Latency:  {result.model_a_metrics.latency_p50_ms:.0f}ms")
        click.echo(f"\nModel B ({model_b}):")
        click.echo(f"  Accuracy: {result.model_b_metrics.accuracy:.2%}")
        click.echo(f"  F1 Score: {result.model_b_metrics.f1_score:.2%}")
        click.echo(f"  Latency:  {result.model_b_metrics.latency_p50_ms:.0f}ms")
        click.echo(f"\nWinner: {result.winner}")
        click.echo(f"Accuracy improvement: {result.accuracy_improvement:+.2%}")
        click.echo(f"F1 improvement: {result.f1_improvement:+.2%}")
        click.echo(f"Latency improvement: {result.latency_improvement_ms:+.0f}ms")

    asyncio.run(_compare())


@cli.command()
@click.option("--model", required=True, help="Model internal ID or provider ID")
@click.option(
    "--to",
    "target",
    type=click.Choice(["canary", "production"]),
    required=True,
    help="Promotion target",
)
@click.option("--traffic", default=10, help="Canary traffic percentage (1-50)")
def promote(model, target, traffic):
    """Promote model to canary or production."""
    registry = ModelRegistry()
    manager = DeploymentManager(registry)

    # Find model
    model_version = registry.get(model) or registry.get_by_model_id(model)
    if not model_version:
        click.echo(f"Error: Model not found: {model}")
        click.echo("Use 'list-models' to see available models")
        return

    async def _promote():
        if target == "canary":
            result = await manager.promote_to_canary(
                model_version.id, traffic_percentage=traffic
            )
            click.echo(f"\nModel promoted to canary at {traffic}% traffic")
            click.echo(f"  Internal ID: {result.id}")
            click.echo(f"  Model ID: {result.model_id}")
        else:
            result = await manager.promote_to_production(model_version.id)
            click.echo(f"\nModel promoted to production (100% traffic)")
            click.echo(f"  Internal ID: {result.id}")
            click.echo(f"  Model ID: {result.model_id}")

    asyncio.run(_promote())


@cli.command()
@click.option("--task", required=True, type=click.Choice([t.value for t in TaskType]))
def rollback(task):
    """Rollback to previous production model."""
    registry = ModelRegistry()
    manager = DeploymentManager(registry)

    async def _rollback():
        try:
            result = await manager.rollback(TaskType(task))
            click.echo(f"\nRolled back to: {result.model_id}")
            click.echo(f"  Internal ID: {result.id}")
            click.echo(f"  Version: {result.version}")
        except ValueError as e:
            click.echo(f"Error: {e}")

    asyncio.run(_rollback())


@cli.command("list-models")
@click.option("--task", default=None, type=click.Choice([t.value for t in TaskType]))
@click.option("--status", default=None, type=click.Choice(["testing", "canary", "production", "deprecated"]))
def list_models(task, status):
    """List registered models."""
    registry = ModelRegistry()

    task_type = TaskType(task) if task else None
    models = registry.list_models(task_type=task_type, status=status)

    click.echo("\nRegistered Models:")
    click.echo("-" * 80)

    if not models:
        click.echo("  No models found")
        return

    for m in models:
        traffic = f" ({m.traffic_percentage:.0f}%)" if m.traffic_percentage > 0 else ""
        accuracy = f"  acc={m.accuracy:.1%}" if m.accuracy else ""
        click.echo(
            f"  [{m.status:10}] {m.task_type.value:20} v{m.version}{traffic}{accuracy}"
        )
        click.echo(f"             ID: {m.id}")
        click.echo(f"             Model: {m.model_id}")


@cli.command()
def stats():
    """Show training data statistics for all task types."""
    builder = DatasetBuilder()

    async def _stats():
        click.echo("\nTraining Data Statistics:")
        click.echo("=" * 60)

        for task_type in TaskType:
            stats = await builder.get_dataset_stats(task_type)
            if stats["total_samples"] == 0:
                continue

            click.echo(f"\n{task_type.value}:")
            click.echo(f"  Total: {stats['total_samples']}")
            click.echo(f"  Usable (>70% conf): {stats['usable_samples']}")
            click.echo(f"  Avg confidence: {stats['average_confidence']:.1%}")

            quality = stats["quality_distribution"]
            click.echo(f"  Quality: verified={quality.get('verified', 0)} "
                      f"auto={quality.get('auto', 0)} "
                      f"corrected={quality.get('corrected', 0)} "
                      f"pending={quality.get('pending', 0)}")

    asyncio.run(_stats())


if __name__ == "__main__":
    cli()
