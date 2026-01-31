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
    api_base_url: str = Field(default="http://localhost:8000")
    cors_origins: list[str] = Field(default=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"])
    environment: Literal["development", "production"] = Field(default="development")

    # OAuth - Google (Gmail, Calendar, Docs)
    google_client_id: str = Field(default="")
    google_client_secret: str = Field(default="")

    # OAuth - Slack
    slack_client_id: str = Field(default="")
    slack_client_secret: str = Field(default="")

    # OAuth - Microsoft (Outlook, Teams)
    microsoft_client_id: str = Field(default="")
    microsoft_client_secret: str = Field(default="")
    microsoft_tenant_id: str = Field(default="common")

    # OAuth - Notion
    notion_client_id: str = Field(default="")
    notion_client_secret: str = Field(default="")

    # OAuth - HubSpot
    hubspot_client_id: str = Field(default="")
    hubspot_client_secret: str = Field(default="")

    # OAuth - Meta (WhatsApp Business)
    meta_app_id: str = Field(default="")
    meta_app_secret: str = Field(default="")
    whatsapp_business_id: str = Field(default="")

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    log_format: Literal["json", "text"] = Field(default="json")

    # Performance
    max_concurrent_analyses: int = Field(default=10)
    llm_rate_limit_per_minute: int = Field(default=60)
    circuit_breaker_threshold: int = Field(default=5)
    circuit_breaker_reset_seconds: int = Field(default=30)

    # Kafka Streaming
    kafka_enabled: bool = Field(default=False)  # Enable to start Kafka producer/consumer
    kafka_bootstrap_servers: str = Field(default="localhost:9092")
    kafka_security_protocol: str = Field(default="PLAINTEXT")  # Use SASL_SSL for Upstash
    kafka_sasl_mechanism: str | None = Field(default=None)  # Use SCRAM-SHA-256 for Upstash
    kafka_sasl_username: str | None = Field(default=None)
    kafka_sasl_password: str | None = Field(default=None)
    kafka_consumer_group_id: str = Field(default="drovi-intelligence")
    kafka_auto_offset_reset: str = Field(default="earliest")
    kafka_enable_auto_commit: bool = Field(default=False)
    kafka_batch_size: int = Field(default=100)
    kafka_linger_ms: int = Field(default=10)
    kafka_ssl_ca_location: str | None = Field(default=None)  # Path to CA cert if needed

    # Kafka Topics
    kafka_topic_raw_events: str = Field(default="drovi-raw-events")
    kafka_topic_intelligence: str = Field(default="drovi-intelligence")
    kafka_topic_graph_changes: str = Field(default="drovi-graph-changes")

    # Orchestrator
    orchestrator_timeout_seconds: int = Field(default=60)
    auto_approval_threshold: float = Field(default=0.85)
    human_review_threshold: float = Field(default=0.5)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
