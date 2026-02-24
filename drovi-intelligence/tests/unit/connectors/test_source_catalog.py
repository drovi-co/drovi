from __future__ import annotations

from pathlib import Path

from src.connectors.source_catalog import (
    default_source_catalog_path,
    load_source_catalog,
    resolve_project_path,
)


def _find_source(catalog, source_key: str):
    for source in catalog.sources:
        if source.source_key == source_key:
            return source
    return None


def test_source_catalog_file_exists_and_loads() -> None:
    path = default_source_catalog_path()
    assert path.exists(), "Missing source catalog at config/source_catalog.yaml"

    catalog = load_source_catalog(path)
    assert catalog.catalog_version == "1.0"
    assert len(catalog.sources) >= 5


def test_source_catalog_enforces_classification_and_governance_fields() -> None:
    catalog = load_source_catalog()

    allowed = {"authoritative", "commercial", "osint"}
    cadence_allowed = {"hot", "warm", "cold", "event_driven"}
    for source in catalog.sources:
        assert source.classification in allowed
        assert source.licensing.data_usage_license
        assert source.sla.freshness_slo_minutes > 0
        assert source.sla.expected_latency_seconds > 0
        assert source.backfill_policy.max_window_days >= source.backfill_policy.default_window_days
        assert source.cadence.policy in cadence_allowed
        assert source.cadence.min_interval_minutes <= source.cadence.default_interval_minutes
        assert source.cadence.default_interval_minutes <= source.cadence.max_interval_minutes
        assert source.cadence.catchup_interval_minutes <= source.cadence.default_interval_minutes


def test_source_catalog_links_authoritative_inventory_and_template() -> None:
    catalog = load_source_catalog()

    inventory_path = resolve_project_path(catalog.authoritative_inventory_path)
    checklist_path = resolve_project_path(catalog.onboarding_checklist_template)

    assert inventory_path.exists()
    assert inventory_path.name == "DROVI_WORLD_BRAIN_INGESTION_MATRIX.md"
    assert checklist_path.exists()
    assert checklist_path.name == "source_onboarding_checklist.md"


def test_worldnewsapi_entry_has_secure_api_key_contract() -> None:
    catalog = load_source_catalog()
    world_news = _find_source(catalog, "worldnewsapi")
    assert world_news is not None
    assert world_news.classification == "commercial"
    assert world_news.credentials.mode == "api_key"
    assert "WORLD_NEWS_API_KEY" in world_news.credentials.required_env_vars
    assert world_news.credentials.customer_supplied_supported is True
    assert world_news.cadence.policy == "hot"
    assert world_news.cadence.default_interval_minutes <= 5


def test_cisa_kev_entry_is_authoritative_and_public() -> None:
    catalog = load_source_catalog()
    source = _find_source(catalog, "cisa_kev")
    assert source is not None
    assert source.classification == "authoritative"
    assert source.credentials.mode == "none"
    assert source.backfill_policy.replayable is True


def test_commercial_premium_entry_supports_customer_credentials() -> None:
    catalog = load_source_catalog()
    source = _find_source(catalog, "commercial_premium")
    assert source is not None
    assert source.classification == "commercial"
    assert source.credentials.customer_supplied_supported is True
    assert source.tenancy == "customer_supplied_credentials"


def test_source_onboarding_checklist_has_required_sections() -> None:
    catalog = load_source_catalog()
    checklist_path = resolve_project_path(catalog.onboarding_checklist_template)
    text = Path(checklist_path).read_text(encoding="utf-8")

    assert "## 1. Auth and Access" in text
    assert "## 2. Quotas and Rate Limits" in text
    assert "## 3. Licensing and Legal" in text
    assert "## 4. Reliability and Operations" in text
    assert "## 5. Schema and Mapping" in text
