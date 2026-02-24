from src.world_model.impact import ImpactEngineV2


def test_compute_bridges_generates_external_to_internal_impacts() -> None:
    engine = ImpactEngineV2()
    bridges = engine.compute_bridges(
        internal_objects=[
            {
                "id": "obj_legal_commitment",
                "type": "commitment",
                "entity_refs": ["acme"],
                "dependency_refs": ["tax_rule_2026"],
                "materiality": 0.9,
            },
            {
                "id": "obj_unrelated_task",
                "type": "task",
                "entity_refs": ["globex"],
                "materiality": 0.2,
            },
        ],
        external_events=[
            {
                "event_id": "ev_tax_1",
                "domain": "legal",
                "entity_refs": ["tax_rule_2026"],
                "reliability": 0.9,
                "materiality": 0.85,
            }
        ],
        causal_strength_by_ref={"obj_legal_commitment": 0.8},
        min_score=0.4,
    )

    assert bridges
    assert any(item.internal_object_ref == "obj_legal_commitment" for item in bridges)
    assert all(item.impact_score >= 0.4 for item in bridges)


def test_dedupe_and_throttle_controls_alert_noise() -> None:
    engine = ImpactEngineV2()
    bridges = engine.compute_bridges(
        internal_objects=[
            {
                "id": "obj_supply",
                "type": "risk",
                "entity_refs": ["supply_chain"],
                "dependency_refs": ["chip_foundry"],
                "materiality": 0.85,
            }
        ],
        external_events=[
            {
                "event_id": "ev_chip_1",
                "domain": "macro",
                "entity_refs": ["chip_foundry"],
                "reliability": 0.9,
                "materiality": 0.8,
            },
            {
                "event_id": "ev_chip_1",
                "domain": "macro",
                "entity_refs": ["chip_foundry"],
                "reliability": 0.88,
                "materiality": 0.78,
            },
        ],
        min_score=0.2,
        max_per_internal=1,
        max_total=1,
    )

    assert len(bridges) == 1
    assert bridges[0].internal_object_ref == "obj_supply"


def test_risk_appetite_overlay_changes_impact_score() -> None:
    engine = ImpactEngineV2()
    low_overlay = {"default_multiplier": 0.7, "object_type_multipliers": {"commitment": 1.0}}
    high_overlay = {"default_multiplier": 1.3, "object_type_multipliers": {"commitment": 1.2}}

    low = engine.compute_bridges(
        internal_objects=[
            {
                "id": "obj_contract",
                "type": "commitment",
                "entity_refs": ["acme"],
                "dependency_refs": ["reg_rule"],
                "materiality": 0.8,
            }
        ],
        external_events=[
            {
                "event_id": "ev_reg_1",
                "domain": "legal",
                "entity_refs": ["reg_rule"],
                "reliability": 0.86,
                "materiality": 0.75,
            }
        ],
        risk_overlay=low_overlay,
        min_score=0.1,
    )
    high = engine.compute_bridges(
        internal_objects=[
            {
                "id": "obj_contract",
                "type": "commitment",
                "entity_refs": ["acme"],
                "dependency_refs": ["reg_rule"],
                "materiality": 0.8,
            }
        ],
        external_events=[
            {
                "event_id": "ev_reg_1",
                "domain": "legal",
                "entity_refs": ["reg_rule"],
                "reliability": 0.86,
                "materiality": 0.75,
            }
        ],
        risk_overlay=high_overlay,
        min_score=0.1,
    )

    assert low and high
    assert high[0].impact_score > low[0].impact_score
