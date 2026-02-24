from src.normative import parse_contract_constraint, parse_legal_constraint, parse_normative_source


def test_parse_legal_constraint_builds_dsl_machine_rule() -> None:
    constraint = parse_legal_constraint(
        {
            "constraint_id": "legal_1",
            "title": "Regulatory cap",
            "clause_text": "Exposure must not exceed 5.",
            "fact_path": "external.high_impact_edges",
            "severity": "high",
            "scope_entities": ["acme"],
            "scope_actions": ["notify_gc"],
            "evidence_refs": ["ev_1"],
        }
    )

    assert constraint.constraint_id == "legal_1"
    assert constraint.machine_rule.startswith("dsl:")
    assert constraint.source_class == "legal"
    assert constraint.scope_entities == ["acme"]
    assert constraint.scope_actions == ["notify_gc"]


def test_parse_normative_source_routes_contract_payload() -> None:
    constraint = parse_normative_source(
        {
            "constraint_id": "contract_1",
            "source_class": "contract",
            "title": "Clause required",
            "clause": {
                "path": "subject.contract_clause",
                "operator": "contains",
                "value": "force_majeure",
            },
            "scope_entities": ["client_1"],
            "scope_actions": ["revise_clause_template"],
        }
    )

    assert constraint.constraint_id == "contract_1"
    assert constraint.source_class == "contract"
    assert "force_majeure" in constraint.machine_rule
    assert constraint.scope_entities == ["client_1"]
    assert constraint.scope_actions == ["revise_clause_template"]


def test_parse_contract_constraint_supports_explicit_machine_rule() -> None:
    constraint = parse_contract_constraint(
        {
            "constraint_id": "contract_2",
            "title": "Custom machine rule",
            "machine_rule": "fact:internal.open_risks <= 3",
            "severity_on_breach": "medium",
            "scope_entities": ["portfolio_a"],
        }
    )

    assert constraint.machine_rule == "fact:internal.open_risks <= 3"
    assert constraint.source_class == "contract"
    assert constraint.scope_entities == ["portfolio_a"]
