"""
LLM Service with Multi-Provider Routing

Provides a unified interface for LLM calls with:
- Multi-provider routing (Together.ai, Fireworks, OpenAI)
- Automatic fallback on provider failures
- Structured output support via Pydantic
- Circuit breaker for resilience
- Token counting and cost tracking

Uses Together.ai v2 SDK as primary provider.
"""

import asyncio
import json
import os
import time
from typing import Any, TypeVar, get_origin

import structlog
from pydantic import BaseModel, ValidationError

from src.config import get_settings

from .providers import (
    PROVIDER_CONFIGS,
    ModelTier,
    Provider,
    get_available_providers,
    get_model_for_tier,
)

logger = structlog.get_logger()

T = TypeVar("T", bound=BaseModel)


# =============================================================================
# LLM Call Tracing
# =============================================================================


class LLMCall:
    """Record of an LLM API call for tracing."""

    def __init__(self, node: str, model: str, provider: str = "unknown"):
        self.node = node
        self.model = model
        self.provider = provider
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.duration_ms = 0
        self.success = False
        self.error: str | None = None
        self.cost_usd: float = 0.0


# =============================================================================
# Circuit Breaker
# =============================================================================


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


# =============================================================================
# Rate Limiter
# =============================================================================


class RateLimiter:
    """Token bucket rate limiter."""

    def __init__(self, requests_per_minute: int):
        self.rate = requests_per_minute / 60.0  # requests per second
        self.tokens = float(requests_per_minute)
        self.max_tokens = float(requests_per_minute)
        self.last_update = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self) -> bool:
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens >= 1:
                self.tokens -= 1
                return True
            return False

    async def wait_for_token(self, timeout: float = 30.0) -> bool:
        start = time.time()
        while time.time() - start < timeout:
            if await self.acquire():
                return True
            await asyncio.sleep(0.1)
        return False


# =============================================================================
# Provider Implementations
# =============================================================================


class TogetherProvider:
    """Together.ai provider using official v2 SDK."""

    def __init__(self, api_key: str | None = None):
        from together import AsyncTogether, Together

        self.api_key = api_key or os.getenv("TOGETHER_API_KEY")
        self.client = Together(api_key=self.api_key)
        self.async_client = AsyncTogether(api_key=self.api_key)

    async def complete(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> tuple[str, int, int]:
        """
        Chat completion using v2 SDK.

        Returns:
            Tuple of (content, prompt_tokens, completion_tokens)
        """
        response = await asyncio.wait_for(
            self.async_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            ),
            timeout=timeout,
        )

        content = response.choices[0].message.content or ""
        prompt_tokens = response.usage.prompt_tokens if response.usage else 0
        completion_tokens = response.usage.completion_tokens if response.usage else 0

        return content, prompt_tokens, completion_tokens

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> tuple[dict[str, Any], int, int]:
        """
        Structured JSON output using v2 SDK.

        Returns:
            Tuple of (parsed_json, prompt_tokens, completion_tokens)
        """
        response = await asyncio.wait_for(
            self.async_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            ),
            timeout=timeout,
        )

        content = response.choices[0].message.content or "{}"
        prompt_tokens = response.usage.prompt_tokens if response.usage else 0
        completion_tokens = response.usage.completion_tokens if response.usage else 0

        return json.loads(content), prompt_tokens, completion_tokens

    async def embed(
        self,
        texts: list[str],
        model: str = "togethercomputer/m2-bert-80M-32k-retrieval",
        timeout: float = 30.0,
    ) -> list[list[float]]:
        """Generate embeddings using v2 SDK."""
        response = await asyncio.wait_for(
            self.async_client.embeddings.create(
                model=model,
                input=texts,
            ),
            timeout=timeout,
        )
        return [data.embedding for data in response.data]


class LiteLLMProvider:
    """Fallback provider using LiteLLM for other providers."""

    def __init__(self, provider: Provider):
        import litellm

        litellm.set_verbose = False
        self.provider = provider
        self.config = PROVIDER_CONFIGS[provider]

    async def complete(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> tuple[str, int, int]:
        """Chat completion using LiteLLM."""
        import litellm

        response = await asyncio.wait_for(
            litellm.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            ),
            timeout=timeout,
        )

        content = response.choices[0].message.content or ""
        prompt_tokens = response.usage.prompt_tokens if response.usage else 0
        completion_tokens = response.usage.completion_tokens if response.usage else 0

        return content, prompt_tokens, completion_tokens

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> tuple[dict[str, Any], int, int]:
        """Structured JSON output using LiteLLM."""
        import litellm

        response = await asyncio.wait_for(
            litellm.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            ),
            timeout=timeout,
        )

        content = response.choices[0].message.content or "{}"
        prompt_tokens = response.usage.prompt_tokens if response.usage else 0
        completion_tokens = response.usage.completion_tokens if response.usage else 0

        return json.loads(content), prompt_tokens, completion_tokens


# =============================================================================
# Provider Router
# =============================================================================


class AllProvidersFailedError(Exception):
    """Raised when all providers fail to complete a request."""

    pass


class ProviderRouter:
    """Routes LLM requests with automatic fallback."""

    def __init__(self):
        self.settings = get_settings()
        self._init_providers()
        self._init_rate_limiters()
        self._init_circuit_breakers()

    def _init_providers(self):
        """Initialize provider instances based on available API keys."""
        self.providers: dict[Provider, TogetherProvider | LiteLLMProvider] = {}

        # Together.ai - use native v2 SDK
        if self.settings.together_api_key:
            self.providers[Provider.TOGETHER] = TogetherProvider(
                api_key=self.settings.together_api_key
            )
            logger.info("Together.ai provider initialized")

        # Other providers - use LiteLLM
        for provider in [Provider.FIREWORKS, Provider.OPENAI, Provider.ANTHROPIC]:
            config = PROVIDER_CONFIGS[provider]
            api_key = os.getenv(config.api_key_env)
            if api_key:
                self.providers[provider] = LiteLLMProvider(provider)
                logger.info("Provider initialized via LiteLLM", provider=provider.value)

    def _init_rate_limiters(self):
        """Initialize rate limiters for each provider."""
        self.rate_limiters: dict[Provider, RateLimiter] = {}
        for provider, config in PROVIDER_CONFIGS.items():
            if provider in self.providers:
                self.rate_limiters[provider] = RateLimiter(config.rate_limit_rpm)

    def _init_circuit_breakers(self):
        """Initialize circuit breakers for each provider."""
        self.circuit_breakers: dict[Provider, CircuitBreaker] = {}
        for provider in self.providers:
            self.circuit_breakers[provider] = CircuitBreaker()

    def _get_provider_order(self) -> list[Provider]:
        """Get providers ordered by priority."""
        available = [p for p in self.providers if p in self.providers]
        return sorted(available, key=lambda p: PROVIDER_CONFIGS[p].priority)

    async def complete_with_fallback(
        self,
        messages: list[dict[str, str]],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        requires_json: bool = False,
        node_name: str = "unknown",
    ) -> tuple[str | dict[str, Any], LLMCall]:
        """
        Complete with automatic fallback across providers.

        Args:
            messages: Chat messages
            model_tier: "fast", "balanced", or "powerful"
            temperature: Sampling temperature
            max_tokens: Max tokens to generate
            requires_json: Whether to use JSON mode
            node_name: Name of calling node for tracing

        Returns:
            Tuple of (response content, LLMCall trace)
        """
        tier = ModelTier(model_tier)
        errors: list[str] = []

        for provider in self._get_provider_order():
            config = PROVIDER_CONFIGS[provider]
            model = get_model_for_tier(provider, tier)
            call = LLMCall(node=node_name, model=model, provider=provider.value)
            start_time = time.time()

            # Check circuit breaker
            if not self.circuit_breakers[provider].can_execute():
                errors.append(f"{provider.value}: circuit breaker open")
                continue

            # Check rate limit
            if not await self.rate_limiters[provider].wait_for_token(timeout=5.0):
                errors.append(f"{provider.value}: rate limited")
                continue

            try:
                provider_impl = self.providers[provider]

                if requires_json:
                    result, prompt_tokens, completion_tokens = (
                        await provider_impl.complete_json(
                            messages=messages,
                            model=model,
                            temperature=temperature,
                            max_tokens=max_tokens,
                        )
                    )
                else:
                    result, prompt_tokens, completion_tokens = (
                        await provider_impl.complete(
                            messages=messages,
                            model=model,
                            temperature=temperature,
                            max_tokens=max_tokens,
                        )
                    )

                # Update call trace
                call.prompt_tokens = prompt_tokens
                call.completion_tokens = completion_tokens
                call.duration_ms = int((time.time() - start_time) * 1000)
                call.success = True
                call.cost_usd = (
                    prompt_tokens * config.cost_per_1m_input / 1_000_000
                    + completion_tokens * config.cost_per_1m_output / 1_000_000
                )

                self.circuit_breakers[provider].record_success()

                logger.debug(
                    "LLM call completed",
                    node=node_name,
                    provider=provider.value,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    duration_ms=call.duration_ms,
                    cost_usd=call.cost_usd,
                )

                return result, call

            except Exception as e:
                call.error = str(e)
                call.duration_ms = int((time.time() - start_time) * 1000)
                self.circuit_breakers[provider].record_failure()
                errors.append(f"{provider.value}: {e}")

                logger.warning(
                    "Provider failed, trying next",
                    provider=provider.value,
                    error=str(e),
                )
                continue

        # All providers failed
        error_msg = f"All providers failed: {'; '.join(errors)}"
        logger.error("All providers failed", errors=errors)
        raise AllProvidersFailedError(error_msg)


# =============================================================================
# LLM Service (Main Interface)
# =============================================================================


class LLMService:
    """
    LLM Service with multi-provider routing and structured outputs.

    Uses Together.ai v2 SDK as primary provider with automatic fallback.
    """

    def __init__(self):
        self.settings = get_settings()
        self.router = ProviderRouter()
        self._setup_models()

    def _setup_models(self):
        """Configure default models based on settings."""
        self.models = {
            "fast": self.settings.default_model_fast,
            "balanced": self.settings.default_model_balanced,
            "powerful": self.settings.default_model_powerful,
        }

        logger.info(
            "LLM service configured",
            fast=self.models["fast"],
            balanced=self.models["balanced"],
            powerful=self.models["powerful"],
            providers=[p.value for p in self.router.providers],
        )

    async def complete(
        self,
        messages: list[dict[str, str]],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        node_name: str = "unknown",
    ) -> tuple[str, LLMCall]:
        """
        Make an LLM completion call with automatic provider fallback.

        Args:
            messages: List of message dicts with role and content
            model_tier: "fast", "balanced", or "powerful"
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            node_name: Name of the calling node for tracing

        Returns:
            Tuple of (response text, LLMCall trace)
        """
        result, call = await self.router.complete_with_fallback(
            messages=messages,
            model_tier=model_tier,
            temperature=temperature,
            max_tokens=max_tokens,
            requires_json=False,
            node_name=node_name,
        )
        return str(result), call

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

        def _coerce_list(value: Any) -> Any:
            if not isinstance(value, str):
                return value
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("```"):
                raw = raw.strip("`").strip()
                if raw.lower().startswith("json"):
                    raw = raw[4:].strip()
            raw = raw.lstrip(" :\n\t")
            # Try direct JSON parse
            try:
                return json.loads(raw)
            except Exception:
                pass
            # Try to extract a JSON list from the string
            start = raw.find("[")
            end = raw.rfind("]")
            if start != -1 and end != -1 and end > start:
                candidate = raw[start : end + 1]
                try:
                    return json.loads(candidate)
                except Exception:
                    return value
            if start != -1 and end == -1:
                # Missing closing bracket; try to close after last object
                obj_end = raw.rfind("}")
                if obj_end != -1 and obj_end > start:
                    candidate = raw[start : obj_end + 1] + "]"
                    try:
                        return json.loads(candidate)
                    except Exception:
                        return []
            # Try to extract a JSON object and wrap it as a list
            obj_start = raw.find("{")
            obj_end = raw.rfind("}")
            if obj_start != -1 and obj_end != -1 and obj_end > obj_start:
                candidate = raw[obj_start : obj_end + 1]
                try:
                    return [json.loads(candidate)]
                except Exception:
                    return []
            return value

        def _extract_json_from_text(text: str) -> Any:
            raw = text.strip()
            if not raw:
                return {}
            if raw.startswith("```"):
                raw = raw.strip("`").strip()
                if raw.lower().startswith("json"):
                    raw = raw[4:].strip()
            # Prefer full object or array
            obj_start = raw.find("{")
            obj_end = raw.rfind("}")
            arr_start = raw.find("[")
            arr_end = raw.rfind("]")
            candidates = []
            if obj_start != -1 and obj_end != -1 and obj_end > obj_start:
                candidates.append(raw[obj_start : obj_end + 1])
            if arr_start != -1 and arr_end != -1 and arr_end > arr_start:
                candidates.append(raw[arr_start : arr_end + 1])
            for candidate in candidates:
                try:
                    return json.loads(candidate)
                except Exception:
                    continue
            # Fallback to direct parse
            try:
                return json.loads(raw)
            except Exception:
                return {}

        def _repair_parsed(parsed: Any) -> Any:
            if not isinstance(parsed, dict):
                return parsed
            for field_name, field in output_schema.model_fields.items():
                if field_name not in parsed:
                    continue
                origin = get_origin(field.annotation)
                if origin is list:
                    parsed[field_name] = _coerce_list(parsed[field_name])
            return parsed

        try:
            result, call = await self.router.complete_with_fallback(
                messages=modified_messages,
                model_tier=model_tier,
                temperature=temperature,
                max_tokens=max_tokens,
                requires_json=True,
                node_name=node_name,
            )

            # Validate with Pydantic
            if isinstance(result, str):
                parsed = json.loads(result)
            else:
                parsed = result

            try:
                validated = output_schema.model_validate(parsed)
                return validated, call
            except ValidationError:
                repaired = _repair_parsed(parsed)
                try:
                    validated = output_schema.model_validate(repaired)
                    return validated, call
                except ValidationError:
                    # Fallback: non-JSON response, extract JSON from text
                    fallback_text, fallback_call = await self.router.complete_with_fallback(
                        messages=modified_messages,
                        model_tier=model_tier,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        requires_json=False,
                        node_name=f"{node_name}_fallback",
                    )
                    extracted = _extract_json_from_text(str(fallback_text))
                    repaired = _repair_parsed(extracted)
                    validated = output_schema.model_validate(repaired)
                    return validated, fallback_call

        except json.JSONDecodeError as e:
            logger.error("LLM returned invalid JSON", error=str(e))
            raise ValueError(f"LLM returned invalid JSON: {e}")

    async def embed(
        self,
        texts: list[str],
        model: str | None = None,
    ) -> list[list[float]]:
        """
        Generate embeddings for texts.

        Args:
            texts: List of texts to embed
            model: Optional model override

        Returns:
            List of embedding vectors
        """
        model = model or self.settings.embedding_model

        # Prefer Together.ai for embeddings
        if Provider.TOGETHER in self.router.providers:
            provider = self.router.providers[Provider.TOGETHER]
            if isinstance(provider, TogetherProvider):
                return await provider.embed(texts, model=model)

        # Fallback to OpenAI embeddings via LiteLLM
        import litellm

        response = await litellm.aembedding(
            model=model,
            input=texts,
        )
        return [item["embedding"] for item in response.data]


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
