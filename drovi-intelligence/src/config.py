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
    falkordb_index_statements: list[str] = Field(default_factory=list)
    falkordb_apply_default_fulltext: bool = Field(default=True)

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
    default_model_fast: str = Field(default="moonshotai/Kimi-K2.5")
    default_model_balanced: str = Field(default="moonshotai/Kimi-K2.5")
    default_model_powerful: str = Field(default="moonshotai/Kimi-K2.5")

    # LLM Settings - Legacy (for backwards compatibility)
    default_llm_model: str = Field(default="gpt-4o")
    fallback_llm_model: str = Field(default="claude-3-5-sonnet-20241022")
    embedding_model: str = Field(default="togethercomputer/m2-bert-80M-32k-retrieval")
    embedding_dimension: int = Field(default=1536)

    # Provider Routing
    prefer_open_source: bool = Field(default=True)
    provider_fallback_enabled: bool = Field(default=True)

    # Fine-Tuning Settings
    finetuning_provider: Literal["together", "fireworks"] = Field(default="together")
    collect_training_data: bool = Field(default=True)
    training_data_sample_rate: float = Field(default=0.1)
    training_data_path: str = Field(default="training_data")
    feedback_finetune_enabled: bool = Field(default=False)
    feedback_finetune_min_samples: int = Field(default=50)

    # TypeScript Backend
    ts_backend_url: str = Field(default="http://localhost:3000")
    ts_internal_secret: str = Field(default="")

    # API Settings
    api_key_salt: str = Field(default="")
    api_base_url: str = Field(default="http://localhost:8000")
    cors_origins: list[str] = Field(default=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"])
    environment: Literal["development", "production", "test"] = Field(default="development")

    # Evidence Storage
    evidence_storage_backend: Literal["local", "s3"] = Field(default="local")
    evidence_storage_path: str = Field(default="/tmp/drovi-evidence")
    evidence_s3_bucket: str = Field(default="")
    evidence_s3_region: str = Field(default="")
    evidence_s3_endpoint_url: str | None = Field(default=None)
    evidence_s3_access_key_id: str | None = Field(default=None)
    evidence_s3_secret_access_key: str | None = Field(default=None)
    evidence_s3_prefix: str = Field(default="drovi-evidence")
    evidence_s3_presign_expiry_seconds: int = Field(default=3600)
    evidence_s3_sse: str | None = Field(default=None)  # e.g. "AES256" or "aws:kms"
    evidence_s3_kms_key_id: str | None = Field(default=None)
    evidence_s3_kms_key_map: dict[str, str] = Field(default_factory=dict)
    evidence_s3_object_lock: bool = Field(default=False)
    evidence_s3_retention_days: int | None = Field(default=None)
    evidence_require_kms: bool = Field(default=False)
    evidence_default_retention_days: int = Field(default=365)
    evidence_immutable_by_default: bool = Field(default=True)
    evidence_legal_hold_by_default: bool = Field(default=False)

    # Compliance
    compliance_recording_consent_required: bool = Field(default=True)
    compliance_blocked_regions: list[str] = Field(default=[])
    compliance_default_region: str = Field(default="US")
    dlp_enabled: bool = Field(default=True)
    dlp_redact: bool = Field(default=True)
    dlp_mask_char: str = Field(default="█")
    dlp_allow_emails: bool = Field(default=False)
    dlp_allow_phone_numbers: bool = Field(default=False)
    guardrails_use_llm: bool = Field(default=True)
    guardrails_max_candidates: int = Field(default=5)
    policy_rules_json: str | None = Field(default=None)
    policy_rules_path: str | None = Field(default=None)
    policy_default_rules_enabled: bool = Field(default=True)

    # ASR (Whisper)
    whisper_model_size: str = Field(default="base")
    whisper_device: str = Field(default="cpu")
    whisper_compute_type: str = Field(default="int8")
    pyannote_auth_token: str | None = Field(default=None)

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

    # Candidate processing
    candidate_processing_enabled: bool = Field(default=True)
    candidate_processing_interval_seconds: int = Field(default=60)

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
    kafka_run_processor_in_api: bool = Field(
        default=False
    )  # Start StreamProcessor in API process (worker runs it separately)
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
    kafka_worker_concurrency: int = Field(default=4)
    kafka_queue_maxsize: int = Field(default=1000)
    kafka_lag_report_interval_seconds: int = Field(default=30)
    kafka_topic_priorities: dict[str, int] = Field(
        default_factory=lambda: {
            "raw.connector.events": 0,
            "normalized.records": 1,
            "intelligence.pipeline.input": 2,
            "drovi-intelligence": 3,
            "graph.changes": 4,
        }
    )

    # Kafka Topics
    kafka_topic_raw_events: str = Field(default="raw.connector.events")
    kafka_topic_normalized_records: str = Field(default="normalized.records")
    kafka_topic_pipeline_input: str = Field(default="intelligence.pipeline.input")
    kafka_topic_intelligence: str = Field(default="drovi-intelligence")
    kafka_topic_graph_changes: str = Field(default="graph.changes")
    kafka_raw_event_mode: Literal["full", "webhook_only", "disabled"] = Field(default="full")

    # Streaming gateway
    streaming_queue_size: int = Field(default=256)
    streaming_worker_concurrency: int = Field(default=2)
    streaming_max_chunk_bytes: int = Field(default=5_000_000)
    streaming_max_latency_ms: int = Field(default=5000)

    # Scheduler
    scheduler_run_in_api: bool = Field(default=True)
    scheduler_advisory_lock_id: int = Field(default=4242001)

    # Orchestrator
    orchestrator_timeout_seconds: int = Field(default=60)
    auto_approval_threshold: float = Field(default=0.85)
    human_review_threshold: float = Field(default=0.5)
    context_cache_enabled: bool = Field(default=True)
    context_cache_ttl_seconds: int = Field(default=900)

    # Memory backend
    memory_backend: Literal["falkordb", "graphiti"] = Field(default="falkordb")

    # Hybrid Search
    hybrid_rrf_k: int = Field(default=60)
    hybrid_weight_vector: float = Field(default=1.0)
    hybrid_weight_fulltext: float = Field(default=0.85)
    hybrid_weight_contains: float = Field(default=0.55)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
