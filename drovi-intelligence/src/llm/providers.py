"""
LLM Provider Configuration and Routing

Supports multiple providers with automatic fallback:
- Together.ai (primary - open-source models)
- Fireworks.ai (fallback - open-source models)
- OpenAI (emergency fallback - proprietary)
"""

from dataclasses import dataclass, field
from enum import Enum


class Provider(str, Enum):
    """Supported LLM providers."""

    TOGETHER = "together"
    FIREWORKS = "fireworks"
    HUGGINGFACE = "huggingface"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


class ModelTier(str, Enum):
    """Model tiers for different use cases."""

    FAST = "fast"  # Quick classifications, low latency
    BALANCED = "balanced"  # Most extractions, good quality/speed tradeoff
    POWERFUL = "powerful"  # Complex analysis, highest quality


@dataclass
class ProviderConfig:
    """Configuration for an LLM provider."""

    name: Provider
    api_key_env: str
    base_url: str
    models: dict[str, str]  # tier -> model_id
    rate_limit_rpm: int
    cost_per_1m_input: float
    cost_per_1m_output: float
    supports_json_mode: bool
    supports_embeddings: bool
    priority: int  # Lower = higher priority

    # Optional settings
    default_timeout: float = 60.0
    max_retries: int = 3


# =============================================================================
# Provider Configurations
# =============================================================================

PROVIDER_CONFIGS: dict[Provider, ProviderConfig] = {
    Provider.TOGETHER: ProviderConfig(
        name=Provider.TOGETHER,
        api_key_env="TOGETHER_API_KEY",
        base_url="https://api.together.xyz/v1",
        models={
            ModelTier.FAST: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
            ModelTier.BALANCED: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
            ModelTier.POWERFUL: "Qwen/Qwen3-235B-A22B-fp8-tput",
        },
        rate_limit_rpm=200,
        cost_per_1m_input=0.18,
        cost_per_1m_output=0.18,
        supports_json_mode=True,
        supports_embeddings=True,
        priority=1,
    ),
    Provider.FIREWORKS: ProviderConfig(
        name=Provider.FIREWORKS,
        api_key_env="FIREWORKS_API_KEY",
        base_url="https://api.fireworks.ai/inference/v1",
        models={
            ModelTier.FAST: "accounts/fireworks/models/llama-v4-scout-instruct",
            ModelTier.BALANCED: "accounts/fireworks/models/llama-v4-maverick-instruct",
            ModelTier.POWERFUL: "accounts/fireworks/models/qwen3-235b",
        },
        rate_limit_rpm=500,
        cost_per_1m_input=0.20,
        cost_per_1m_output=0.20,
        supports_json_mode=True,
        supports_embeddings=True,
        priority=2,
    ),
    Provider.OPENAI: ProviderConfig(
        name=Provider.OPENAI,
        api_key_env="OPENAI_API_KEY",
        base_url="https://api.openai.com/v1",
        models={
            ModelTier.FAST: "gpt-4o-mini",
            ModelTier.BALANCED: "gpt-4o",
            ModelTier.POWERFUL: "gpt-4o",
        },
        rate_limit_rpm=500,
        cost_per_1m_input=2.50,
        cost_per_1m_output=10.00,
        supports_json_mode=True,
        supports_embeddings=True,
        priority=10,  # Only use as emergency fallback
    ),
    Provider.ANTHROPIC: ProviderConfig(
        name=Provider.ANTHROPIC,
        api_key_env="ANTHROPIC_API_KEY",
        base_url="https://api.anthropic.com/v1",
        models={
            ModelTier.FAST: "claude-3-5-haiku-20241022",
            ModelTier.BALANCED: "claude-sonnet-4-20250514",
            ModelTier.POWERFUL: "claude-sonnet-4-20250514",
        },
        rate_limit_rpm=200,
        cost_per_1m_input=3.00,
        cost_per_1m_output=15.00,
        supports_json_mode=True,
        supports_embeddings=False,
        priority=11,  # Emergency fallback only
    ),
}


# =============================================================================
# Embedding Model Configurations
# =============================================================================

@dataclass
class EmbeddingModelConfig:
    """Configuration for embedding models."""

    provider: Provider
    model_id: str
    dimensions: int
    max_tokens: int
    cost_per_1m_tokens: float


EMBEDDING_CONFIGS: dict[str, EmbeddingModelConfig] = {
    "together-m2-bert": EmbeddingModelConfig(
        provider=Provider.TOGETHER,
        model_id="togethercomputer/m2-bert-80M-32k-retrieval",
        dimensions=768,
        max_tokens=32000,
        cost_per_1m_tokens=0.008,
    ),
    "together-bge-large": EmbeddingModelConfig(
        provider=Provider.TOGETHER,
        model_id="BAAI/bge-large-en-v1.5",
        dimensions=1024,
        max_tokens=512,
        cost_per_1m_tokens=0.008,
    ),
    "openai-small": EmbeddingModelConfig(
        provider=Provider.OPENAI,
        model_id="text-embedding-3-small",
        dimensions=1536,
        max_tokens=8191,
        cost_per_1m_tokens=0.02,
    ),
}


# =============================================================================
# Fine-Tuning Supported Base Models
# =============================================================================

FINETUNING_BASE_MODELS: dict[str, str] = {
    "llama4-maverick": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "llama4-scout": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "qwen3-32b": "Qwen/Qwen3-32B-Instruct",
    "mistral-7b": "mistralai/Mistral-7B-Instruct-v0.3",
}


# =============================================================================
# Helper Functions
# =============================================================================

def get_available_providers() -> list[Provider]:
    """Get list of providers with configured API keys (sorted by priority)."""
    import os

    available = []
    for provider, config in PROVIDER_CONFIGS.items():
        if os.getenv(config.api_key_env):
            available.append(provider)

    return sorted(available, key=lambda p: PROVIDER_CONFIGS[p].priority)


def get_model_for_tier(provider: Provider, tier: ModelTier) -> str:
    """Get the model ID for a provider and tier."""
    return PROVIDER_CONFIGS[provider].models[tier]


def get_default_embedding_model() -> EmbeddingModelConfig:
    """Get the default embedding model configuration."""
    return EMBEDDING_CONFIGS["together-m2-bert"]
