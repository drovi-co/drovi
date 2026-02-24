from src.db.schema_validator import REQUIRED_TABLES


def test_schema_validator_requires_world_brain_phase1_tables() -> None:
    required = {
        "observation",
        "observation_evidence_link",
        "belief",
        "belief_revision",
        "hypothesis",
        "hypothesis_score",
        "cognitive_constraint",
        "constraint_violation_candidate",
        "impact_edge",
        "intervention_plan",
        "realized_outcome",
        "uncertainty_state",
        "source_reliability_profile",
    }

    assert required.issubset(set(REQUIRED_TABLES))


def test_schema_validator_requires_world_crawl_fabric_tables() -> None:
    required = {
        "crawl_frontier_entry",
        "crawl_policy_rule",
        "crawl_snapshot",
        "crawl_audit_log",
    }

    assert required.issubset(set(REQUIRED_TABLES))


def test_schema_validator_requires_lakehouse_platform_tables() -> None:
    required = {
        "lakehouse_checkpoint",
        "lakehouse_partition",
        "lakehouse_cost_attribution",
    }

    assert required.issubset(set(REQUIRED_TABLES))
