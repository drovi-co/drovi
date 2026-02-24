from src.normative import NormativeConstraint, NormativeEngine


def test_evaluate_returns_breach_when_rule_is_violated() -> None:
    engine = NormativeEngine()
    violations = engine.evaluate(
        constraints=[
            NormativeConstraint(
                constraint_id="c1",
                title="Maximum drift",
                machine_rule="fact:world.max_pressure <= 0.7",
                severity_on_breach="high",
                source_class="policy",
            )
        ],
        facts={"world": {"max_pressure": 0.9}},
    )

    assert len(violations) == 1
    violation = violations[0]
    assert violation.constraint_id == "c1"
    assert violation.status == "open"
    assert violation.severity == "high"
    assert violation.details["reason"] == "breach"
    assert violation.details["clauses"][0]["actual"] == 0.9


def test_evaluate_returns_warning_for_pre_breach_threshold() -> None:
    engine = NormativeEngine()
    signals = engine.evaluate(
        constraints=[
            NormativeConstraint(
                constraint_id="c2",
                title="Impact edge pressure",
                machine_rule="fact:external.high_impact_edges <= 10",
                severity_on_breach="medium",
                pre_breach_threshold=0.8,
                scope_actions=["triage_high_impact_edges"],
            )
        ],
        facts={"external": {"high_impact_edges": 9}},
    )

    assert len(signals) == 1
    warning = signals[0]
    assert warning.constraint_id == "c2"
    assert warning.status == "warning"
    assert warning.details["reason"] == "pre_breach"
    assert warning.details["recommended_actions"]


def test_evaluate_supports_dsl_and_scope_metadata() -> None:
    engine = NormativeEngine()
    dsl_rule = (
        'dsl:{"version":"1.0","source_class":"legal","obligation_type":"must",'
        '"logic":"all","clauses":[{"path":"internal.overdue_commitments","operator":"<=","value":2}],'
        '"scope":{"entities":["acme"],"actions":["update_client_memo"],"jurisdictions":["us"]},'
        '"thresholds":{"pre_breach_ratio":0.85},"evidence_refs":["ev_1"],"metadata":{}}'
    )
    signals = engine.evaluate(
        constraints=[
            NormativeConstraint(
                constraint_id="c3",
                title="Client advisory SLA",
                machine_rule=dsl_rule,
                severity_on_breach="critical",
                source_class="legal",
                scope_entities=["acme"],
                scope_actions=["update_client_memo"],
                evidence_refs=["ev_1"],
            )
        ],
        facts={"internal": {"overdue_commitments": 3}},
    )

    assert len(signals) == 1
    breach = signals[0]
    assert breach.status == "open"
    assert breach.subject_entity_id == "acme"
    assert breach.details["source_class"] == "legal"
    assert breach.details["scope_actions"] == ["update_client_memo"]
