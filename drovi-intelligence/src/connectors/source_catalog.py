"""Source catalog models and loader for world-intelligence providers."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator


SourceClassification = Literal["authoritative", "commercial", "osint"]
SourceTier = Literal["tier0", "tier1", "tier2"]
CredentialMode = Literal["api_key", "oauth2", "rss", "none", "customer_feed"]
SourceCadencePolicy = Literal["hot", "warm", "cold", "event_driven"]


class SourceCredentials(BaseModel):
    mode: CredentialMode
    required_env_vars: list[str] = Field(default_factory=list)
    customer_supplied_supported: bool = True


class SourceLicensing(BaseModel):
    data_usage_license: str
    redistribution_allowed: bool
    pii_risk: Literal["none", "low", "medium", "high"] = "low"
    terms_url: str | None = None


class SourceSLA(BaseModel):
    freshness_slo_minutes: int = Field(ge=1)
    availability_slo: float = Field(ge=0.0, le=1.0)
    expected_latency_seconds: int = Field(ge=1)
    backfill_latency_hours: int = Field(ge=1)


class SourceBackfillPolicy(BaseModel):
    supported: bool
    default_window_days: int = Field(ge=0)
    max_window_days: int = Field(ge=0)
    checkpoint_strategy: str
    replayable: bool = True


class SourceCadence(BaseModel):
    policy: SourceCadencePolicy
    default_interval_minutes: int = Field(ge=1)
    min_interval_minutes: int = Field(ge=1)
    max_interval_minutes: int = Field(ge=1)
    catchup_interval_minutes: int = Field(ge=1)
    backlog_multiplier: float = Field(ge=1.0, le=10.0, default=2.0)
    voi_priority: float = Field(ge=0.0, le=1.0, default=0.5)


class SourceOnboarding(BaseModel):
    owner_team: str
    runbook_path: str


class SourceCatalogEntry(BaseModel):
    source_key: str
    display_name: str
    tier: SourceTier
    classification: SourceClassification
    provider_type: str
    domains: list[str] = Field(default_factory=list)
    jurisdictions: list[str] = Field(default_factory=list)
    tenancy: str
    credentials: SourceCredentials
    licensing: SourceLicensing
    sla: SourceSLA
    backfill_policy: SourceBackfillPolicy
    cadence: SourceCadence
    onboarding: SourceOnboarding
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_windows(self) -> "SourceCatalogEntry":
        if self.backfill_policy.default_window_days > self.backfill_policy.max_window_days:
            raise ValueError("default_window_days cannot exceed max_window_days")
        if self.cadence.min_interval_minutes > self.cadence.default_interval_minutes:
            raise ValueError("cadence.min_interval_minutes cannot exceed default_interval_minutes")
        if self.cadence.default_interval_minutes > self.cadence.max_interval_minutes:
            raise ValueError("cadence.default_interval_minutes cannot exceed max_interval_minutes")
        if self.cadence.catchup_interval_minutes > self.cadence.default_interval_minutes:
            raise ValueError("cadence.catchup_interval_minutes cannot exceed default_interval_minutes")
        return self


class SourceCatalog(BaseModel):
    catalog_version: str
    authoritative_inventory_path: str
    onboarding_checklist_template: str
    sources: list[SourceCatalogEntry]

    @model_validator(mode="after")
    def _validate_unique_source_keys(self) -> "SourceCatalog":
        seen: set[str] = set()
        for source in self.sources:
            if source.source_key in seen:
                raise ValueError(f"duplicate source_key: {source.source_key}")
            seen.add(source.source_key)
        return self


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_source_catalog_path() -> Path:
    return _project_root() / "config" / "source_catalog.yaml"


def resolve_project_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return (_project_root() / path).resolve()


def load_source_catalog(path: Path | None = None) -> SourceCatalog:
    catalog_path = path or default_source_catalog_path()
    raw = yaml.safe_load(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("source catalog must decode to a mapping")
    return SourceCatalog.model_validate(raw)


@lru_cache(maxsize=1)
def get_source_catalog() -> SourceCatalog:
    return load_source_catalog()
