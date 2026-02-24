from src.attention import AttentionEngine, AttentionItem


def test_schedule_orders_by_voi_and_respects_budget() -> None:
    engine = AttentionEngine()
    decisions = engine.schedule(
        items=[
            AttentionItem(
                ref="item_low",
                domain="finance",
                impact=0.2,
                uncertainty=0.2,
                freshness_lag_minutes=10,
                processing_cost=1.0,
                source_class="osint",
            ),
            AttentionItem(
                ref="item_high",
                domain="legal",
                impact=0.9,
                uncertainty=0.8,
                freshness_lag_minutes=90,
                processing_cost=1.0,
                source_class="authoritative",
            ),
            AttentionItem(
                ref="item_expensive",
                domain="macro",
                impact=0.95,
                uncertainty=0.9,
                freshness_lag_minutes=40,
                processing_cost=10.0,
                source_class="authoritative",
            ),
        ],
        processing_budget=2.0,
    )

    assert decisions
    assert decisions[0].ref == "item_high"
    assert all(item.ref != "item_expensive" for item in decisions)


def test_schedule_allocates_more_compute_to_high_voi_items() -> None:
    engine = AttentionEngine()
    decisions = engine.schedule(
        items=[
            AttentionItem(
                ref="critical_fast",
                domain="legal",
                impact=0.95,
                uncertainty=0.8,
                freshness_lag_minutes=60,
                processing_cost=1.0,
                source_class="authoritative",
                risk_tier="critical",
                sla_minutes=30,
            ),
            AttentionItem(
                ref="low_signal",
                domain="ops",
                impact=0.2,
                uncertainty=0.2,
                freshness_lag_minutes=30,
                processing_cost=1.0,
                source_class="osint",
                risk_tier="low",
                sla_minutes=240,
            ),
        ],
        processing_budget=4.0,
    )

    assert len(decisions) == 2
    assert decisions[0].compute_units > decisions[1].compute_units


def test_schedule_enforces_anti_starvation_for_stale_high_risk_item() -> None:
    engine = AttentionEngine()
    decisions = engine.schedule(
        items=[
            AttentionItem(
                ref="stale_high_risk",
                domain="compliance",
                impact=0.2,
                uncertainty=0.1,
                freshness_lag_minutes=60 * 24 * 21,
                processing_cost=0.5,
                source_class="commercial",
                risk_tier="high",
                last_processed_lag_minutes=60 * 24 * 30,
            ),
            AttentionItem(
                ref="fresh_high_voi",
                domain="finance",
                impact=0.95,
                uncertainty=0.8,
                freshness_lag_minutes=15,
                processing_cost=0.5,
                source_class="authoritative",
                risk_tier="medium",
            ),
        ],
        processing_budget=0.5,
        starvation_slots=1,
        starvation_threshold_minutes=60 * 24 * 14,
    )

    assert decisions
    assert decisions[0].ref == "stale_high_risk"
