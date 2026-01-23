"""
LLM Service with LiteLLM Multi-Provider Routing

Provides a unified interface for LLM calls with:
- Multi-provider routing (OpenAI, Anthropic, Google)
- Structured output support via Pydantic
- Circuit breaker for resilience
- Token counting and cost tracking
"""

import asyncio
import json
import time
from typing import Any, TypeVar

import litellm
import structlog
from pydantic import BaseModel

from src.config import get_settings

logger = structlog.get_logger()

T = TypeVar("T", bound=BaseModel)

# Configure LiteLLM
litellm.set_verbose = False


class LLMCall:
    """Record of an LLM API call for tracing."""

    def __init__(self, node: str, model: str):
        self.node = node
        self.model = model
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.duration_ms = 0
        self.success = False
        self.error: str | None = None


class CircuitBreaker:
    """Simple circuit breaker for LLM calls."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure_time: float | None = None
        self.state = "closed"  # closed, open, half-open

    def can_execute(self) -> bool:
        if self.state == "closed":
            return True

        if self.state == "open":
            if time.time() - (self.last_failure_time or 0) > self.recovery_timeout:
                self.state = "half-open"
                return True
            return False

        # half-open
        return True

    def record_success(self):
        self.failures = 0
        self.state = "closed"

    def record_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()

        if self.failures >= self.failure_threshold:
            self.state = "open"
            logger.warning("Circuit breaker opened", failures=self.failures)


class LLMService:
    """
    LLM Service with multi-provider routing and structured outputs.

    Uses LiteLLM to route requests to the best available provider.
    """

    def __init__(self):
        self.settings = get_settings()
        self.circuit_breaker = CircuitBreaker()
        self._setup_providers()

    def _setup_providers(self):
        """Configure LiteLLM providers based on available API keys."""
        # Primary model configuration
        self.models = {
            "fast": self._get_fast_model(),
            "balanced": self._get_balanced_model(),
            "powerful": self._get_powerful_model(),
        }

        logger.info(
            "LLM providers configured",
            fast=self.models["fast"],
            balanced=self.models["balanced"],
            powerful=self.models["powerful"],
        )

    def _get_fast_model(self) -> str:
        """Get the fastest model for quick classifications."""
        if self.settings.anthropic_api_key:
            return "claude-3-5-haiku-20241022"
        if self.settings.openai_api_key:
            return "gpt-4o-mini"
        if self.settings.google_api_key:
            return "gemini-1.5-flash"
        return "gpt-4o-mini"

    def _get_balanced_model(self) -> str:
        """Get the balanced model for most extractions."""
        if self.settings.anthropic_api_key:
            return "claude-sonnet-4-20250514"
        if self.settings.openai_api_key:
            return "gpt-4o"
        if self.settings.google_api_key:
            return "gemini-1.5-pro"
        return "gpt-4o"

    def _get_powerful_model(self) -> str:
        """Get the most powerful model for complex analysis."""
        if self.settings.anthropic_api_key:
            return "claude-sonnet-4-20250514"
        if self.settings.openai_api_key:
            return "gpt-4o"
        if self.settings.google_api_key:
            return "gemini-1.5-pro"
        return "gpt-4o"

    async def complete(
        self,
        messages: list[dict[str, str]],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        node_name: str = "unknown",
    ) -> tuple[str, LLMCall]:
        """
        Make an LLM completion call.

        Args:
            messages: List of message dicts with role and content
            model_tier: "fast", "balanced", or "powerful"
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            node_name: Name of the calling node for tracing

        Returns:
            Tuple of (response text, LLMCall trace)
        """
        model = self.models.get(model_tier, self.models["balanced"])
        call = LLMCall(node=node_name, model=model)
        start_time = time.time()

        if not self.circuit_breaker.can_execute():
            call.error = "Circuit breaker open"
            raise Exception("LLM circuit breaker is open")

        try:
            response = await litellm.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            # Extract response
            content = response.choices[0].message.content
            call.prompt_tokens = response.usage.prompt_tokens
            call.completion_tokens = response.usage.completion_tokens
            call.duration_ms = int((time.time() - start_time) * 1000)
            call.success = True

            self.circuit_breaker.record_success()

            logger.debug(
                "LLM call completed",
                node=node_name,
                model=model,
                prompt_tokens=call.prompt_tokens,
                completion_tokens=call.completion_tokens,
                duration_ms=call.duration_ms,
            )

            return content, call

        except Exception as e:
            call.error = str(e)
            call.duration_ms = int((time.time() - start_time) * 1000)
            self.circuit_breaker.record_failure()

            logger.error(
                "LLM call failed",
                node=node_name,
                model=model,
                error=str(e),
            )
            raise

    async def complete_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[T],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        node_name: str = "unknown",
    ) -> tuple[T, LLMCall]:
        """
        Make an LLM completion call with structured output.

        Uses JSON mode and Pydantic for validation.

        Args:
            messages: List of message dicts with role and content
            output_schema: Pydantic model class for output validation
            model_tier: "fast", "balanced", or "powerful"
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            node_name: Name of the calling node for tracing

        Returns:
            Tuple of (validated Pydantic model, LLMCall trace)
        """
        # Add schema instruction to system message
        schema_json = output_schema.model_json_schema()
        schema_instruction = f"""

You must respond with valid JSON that matches this schema:
{json.dumps(schema_json, indent=2)}

Respond ONLY with the JSON object, no additional text."""

        # Modify messages to include schema
        modified_messages = []
        for msg in messages:
            if msg["role"] == "system":
                modified_messages.append({
                    "role": "system",
                    "content": msg["content"] + schema_instruction,
                })
            else:
                modified_messages.append(msg)

        # If no system message, add one
        if not any(msg["role"] == "system" for msg in messages):
            modified_messages.insert(0, {
                "role": "system",
                "content": f"You are an AI assistant that responds with structured JSON.{schema_instruction}",
            })

        model = self.models.get(model_tier, self.models["balanced"])
        call = LLMCall(node=node_name, model=model)
        start_time = time.time()

        if not self.circuit_breaker.can_execute():
            call.error = "Circuit breaker open"
            raise Exception("LLM circuit breaker is open")

        try:
            response = await litellm.acompletion(
                model=model,
                messages=modified_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )

            content = response.choices[0].message.content
            call.prompt_tokens = response.usage.prompt_tokens
            call.completion_tokens = response.usage.completion_tokens
            call.duration_ms = int((time.time() - start_time) * 1000)

            # Parse and validate JSON
            try:
                parsed = json.loads(content)
                validated = output_schema.model_validate(parsed)
                call.success = True
                self.circuit_breaker.record_success()

                logger.debug(
                    "Structured LLM call completed",
                    node=node_name,
                    model=model,
                    prompt_tokens=call.prompt_tokens,
                    completion_tokens=call.completion_tokens,
                    duration_ms=call.duration_ms,
                )

                return validated, call

            except json.JSONDecodeError as e:
                call.error = f"Invalid JSON: {e}"
                logger.error("LLM returned invalid JSON", content=content[:200])
                raise ValueError(f"LLM returned invalid JSON: {e}")

            except Exception as e:
                call.error = f"Validation failed: {e}"
                logger.error("LLM output validation failed", error=str(e))
                raise

        except Exception as e:
            if not call.error:
                call.error = str(e)
            call.duration_ms = int((time.time() - start_time) * 1000)
            self.circuit_breaker.record_failure()

            logger.error(
                "Structured LLM call failed",
                node=node_name,
                model=model,
                error=str(e),
            )
            raise


# =============================================================================
# Singleton
# =============================================================================

_llm_service: LLMService | None = None


def get_llm_service() -> LLMService:
    """Get the singleton LLM service instance."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
