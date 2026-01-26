"""Application configuration using Pydantic Settings."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/drovi"
    )

    # FalkorDB (Graph Database)
    falkordb_host: str = Field(default="localhost")
    falkordb_port: int = Field(default=6379)
    falkordb_graph_name: str = Field(default="drovi_intelligence")

    # Redis
    redis_url: RedisDsn = Field(default="redis://localhost:6379/0")

    # LLM Providers - Open Source (Preferred)
    together_api_key: str | None = Field(default=None)
    fireworks_api_key: str | None = Field(default=None)
    huggingface_api_key: str | None = Field(default=None)

    # LLM Providers - Proprietary (Fallback)
    openai_api_key: str | None = Field(default=None)
    anthropic_api_key: str | None = Field(default=None)
    google_ai_api_key: str | None = Field(default=None)

    # LLM Settings - Default Models (Open Source)
    default_model_fast: str = Field(default="meta-llama/Llama-4-Scout-17B-16E-Instruct")
    default_model_balanced: str = Field(default="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
    default_model_powerful: str = Field(default="Qwen/Qwen3-235B-A22B-fp8-tput")

    # LLM Settings - Legacy (for backwards compatibility)
    default_llm_model: str = Field(default="gpt-4o")
    fallback_llm_model: str = Field(default="claude-3-5-sonnet-20241022")
    embedding_model: str = Field(default="togethercomputer/m2-bert-80M-32k-retrieval")

    # Provider Routing
    prefer_open_source: bool = Field(default=True)
    provider_fallback_enabled: bool = Field(default=True)

    # Fine-Tuning Settings
    finetuning_provider: Literal["together", "fireworks"] = Field(default="together")
    collect_training_data: bool = Field(default=True)
    training_data_sample_rate: float = Field(default=0.1)
    training_data_path: str = Field(default="training_data")

    # TypeScript Backend
    ts_backend_url: str = Field(default="http://localhost:3000")
    ts_internal_secret: str = Field(default="")

    # API Settings
    api_key_salt: str = Field(default="")
    cors_origins: list[str] = Field(default=["http://localhost:5173", "http://localhost:3000"])

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    log_format: Literal["json", "text"] = Field(default="json")

    # Performance
    max_concurrent_analyses: int = Field(default=10)
    llm_rate_limit_per_minute: int = Field(default=60)
    circuit_breaker_threshold: int = Field(default=5)
    circuit_breaker_reset_seconds: int = Field(default=30)

    # Orchestrator
    orchestrator_timeout_seconds: int = Field(default=60)
    auto_approval_threshold: float = Field(default=0.85)
    human_review_threshold: float = Field(default=0.5)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
