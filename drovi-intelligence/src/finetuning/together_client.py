"""
Together.ai Fine-Tuning Client using Official v2 SDK.

Provides a high-level interface for:
- File uploads
- Fine-tuning job management
- Model deployment
- Job monitoring

Docs: https://docs.together.ai/
"""

import asyncio
from datetime import datetime
from pathlib import Path

import structlog
from together import AsyncTogether, Together
from together.types import FinetuneResponse

from src.config import get_settings

from .schemas import FineTuningJob, TaskType

logger = structlog.get_logger()


# Supported base models for fine-tuning
SUPPORTED_MODELS = {
    "llama4-maverick": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "llama4-scout": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "qwen3-32b": "Qwen/Qwen3-32B-Instruct",
    "mistral-7b": "mistralai/Mistral-7B-Instruct-v0.3",
}


class TogetherFineTuning:
    """Together.ai fine-tuning client using official v2 SDK."""

    def __init__(self, api_key: str | None = None):
        """
        Initialize the fine-tuning client.

        Args:
            api_key: Together API key. Uses TOGETHER_API_KEY env var if not provided.
        """
        settings = get_settings()
        self.api_key = api_key or settings.together_api_key

        if not self.api_key:
            raise ValueError(
                "Together API key not found. Set TOGETHER_API_KEY environment variable."
            )

        # Initialize v2 SDK clients
        self.client = Together(api_key=self.api_key)
        self.async_client = AsyncTogether(api_key=self.api_key)

    def upload_dataset(self, file_path: Path) -> str:
        """
        Upload training file to Together.ai.

        Args:
            file_path: Path to JSONL training file

        Returns:
            File ID for use in fine-tuning
        """
        logger.info("Uploading training file", path=str(file_path))

        if not file_path.exists():
            raise FileNotFoundError(f"Training file not found: {file_path}")

        response = self.client.files.upload(
            file=str(file_path),
            purpose="fine-tune",
        )

        logger.info("File uploaded", file_id=response.id)
        return response.id

    def create_finetuning_job(
        self,
        training_file_id: str,
        task_type: TaskType,
        base_model: str = "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        n_epochs: int = 3,
        learning_rate: float = 1e-5,
        batch_size: int = 4,
        suffix: str = "drovi",
        # LoRA parameters
        lora: bool = True,
        lora_r: int = 16,
        lora_alpha: int = 32,
        lora_dropout: float = 0.05,
        # Validation
        validation_file_id: str | None = None,
    ) -> FineTuningJob:
        """
        Start a fine-tuning job on Together.ai.

        Args:
            training_file_id: ID from upload_dataset()
            task_type: Task this model is being fine-tuned for
            base_model: Base model to fine-tune
            n_epochs: Number of training epochs
            learning_rate: Learning rate
            batch_size: Batch size
            suffix: Model name suffix
            lora: Use LoRA fine-tuning
            lora_r: LoRA rank
            lora_alpha: LoRA alpha scaling
            lora_dropout: LoRA dropout
            validation_file_id: Optional validation file ID

        Returns:
            FineTuningJob with job details
        """
        logger.info(
            "Creating fine-tuning job",
            model=base_model,
            epochs=n_epochs,
            lora=lora,
            task_type=task_type.value,
        )

        # Build creation parameters
        create_params = {
            "training_file": training_file_id,
            "model": base_model,
            "n_epochs": n_epochs,
            "learning_rate": learning_rate,
            "batch_size": batch_size,
            "suffix": f"{suffix}-{task_type.value}",
            "lora": lora,
        }

        # Add LoRA params if enabled
        if lora:
            create_params.update({
                "lora_r": lora_r,
                "lora_alpha": lora_alpha,
                "lora_dropout": lora_dropout,
            })

        # Add validation file if provided
        if validation_file_id:
            create_params["validation_file"] = validation_file_id

        # Create job using v2 SDK
        job = self.client.fine_tuning.create(**create_params)

        logger.info("Fine-tuning job created", job_id=job.id)

        return FineTuningJob(
            id=f"drovi-ft-{job.id}",
            task_type=task_type,
            base_model=base_model,
            provider="together",
            status=job.status,
            provider_job_id=job.id,
            epochs=n_epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            lora_enabled=lora,
            lora_rank=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            created_at=datetime.utcnow(),
        )

    def get_job_status(self, job_id: str) -> FinetuneResponse:
        """
        Get fine-tuning job status.

        Args:
            job_id: Together.ai job ID

        Returns:
            FinetuneResponse with current status
        """
        return self.client.fine_tuning.retrieve(id=job_id)

    def list_jobs(self) -> list[FinetuneResponse]:
        """List all fine-tuning jobs."""
        response = self.client.fine_tuning.list()
        return response.data if response.data else []

    def cancel_job(self, job_id: str) -> None:
        """
        Cancel a fine-tuning job.

        Args:
            job_id: Together.ai job ID
        """
        self.client.fine_tuning.cancel(id=job_id)
        logger.info("Job cancelled", job_id=job_id)

    def wait_for_completion(
        self,
        job_id: str,
        poll_interval: int = 60,
        timeout_minutes: int = 180,
    ) -> FinetuneResponse:
        """
        Poll until job completes.

        Args:
            job_id: Fine-tuning job ID
            poll_interval: Seconds between status checks
            timeout_minutes: Maximum wait time in minutes

        Returns:
            Completed job with final status
        """
        import time

        logger.info("Waiting for job completion", job_id=job_id)

        start_time = time.time()
        timeout_seconds = timeout_minutes * 60

        while True:
            job = self.get_job_status(job_id)

            if job.status in ("completed", "succeeded"):
                logger.info(
                    "Job completed successfully",
                    job_id=job_id,
                    output_model=getattr(job, "output_name", None),
                )
                return job

            if job.status in ("failed", "cancelled"):
                logger.error("Job failed", job_id=job_id, status=job.status)
                return job

            # Check timeout
            if time.time() - start_time > timeout_seconds:
                logger.error(
                    "Job timed out waiting for completion",
                    job_id=job_id,
                    timeout_minutes=timeout_minutes,
                )
                raise TimeoutError(f"Job {job_id} did not complete within {timeout_minutes} minutes")

            logger.debug(
                "Job still running",
                job_id=job_id,
                status=job.status,
            )
            time.sleep(poll_interval)

    def list_checkpoints(self, job_id: str) -> list:
        """
        List checkpoints for a fine-tuning job.

        Args:
            job_id: Fine-tuning job ID

        Returns:
            List of checkpoint objects
        """
        response = self.client.fine_tuning.list_checkpoints(job_id)
        return list(response.data) if hasattr(response, "data") else []

    def download_model(self, job_id: str, output_path: Path) -> None:
        """
        Download fine-tuned model weights.

        Args:
            job_id: Fine-tuning job ID
            output_path: Path to save the model
        """
        with self.client.fine_tuning.with_streaming_response.content(
            ft_id=job_id
        ) as response:
            with open(output_path, "wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
        logger.info("Model downloaded", path=str(output_path))

    # ==========================================================================
    # Async versions for use in orchestrator
    # ==========================================================================

    async def async_get_job_status(self, job_id: str) -> FinetuneResponse:
        """Async version of get_job_status."""
        return await self.async_client.fine_tuning.retrieve(id=job_id)

    async def async_wait_for_completion(
        self,
        job_id: str,
        poll_interval: int = 60,
        timeout_minutes: int = 180,
    ) -> FinetuneResponse:
        """
        Async version of wait_for_completion.

        Args:
            job_id: Fine-tuning job ID
            poll_interval: Seconds between status checks
            timeout_minutes: Maximum wait time

        Returns:
            Completed job
        """
        import time

        logger.info("Waiting for job completion (async)", job_id=job_id)

        start_time = time.time()
        timeout_seconds = timeout_minutes * 60

        while True:
            job = await self.async_get_job_status(job_id)

            if job.status in ("completed", "succeeded"):
                return job

            if job.status in ("failed", "cancelled"):
                return job

            if time.time() - start_time > timeout_seconds:
                raise TimeoutError(f"Job {job_id} timed out")

            await asyncio.sleep(poll_interval)


def get_finetuning_client() -> TogetherFineTuning:
    """Get a fine-tuning client instance."""
    return TogetherFineTuning()
