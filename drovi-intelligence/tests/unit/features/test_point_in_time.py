from datetime import UTC, datetime

from src.features import FeatureDefinition, FeatureRecord, PointInTimeFeatureExtractor


def test_point_in_time_extractor_prevents_future_leakage() -> None:
    extractor = PointInTimeFeatureExtractor(
        definitions=[
            FeatureDefinition(
                name="risk_score",
                source_table="gold.risk_features",
                value_type="float",
                default_value=0.0,
            )
        ]
    )
    as_of = datetime(2026, 2, 20, 12, 0, tzinfo=UTC)
    snapshot = extractor.extract_snapshot(
        entity_id="acct_1",
        as_of=as_of,
        records=[
            FeatureRecord(
                entity_id="acct_1",
                feature_name="risk_score",
                feature_value=0.4,
                event_time=datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
                available_at=datetime(2026, 2, 20, 10, 5, tzinfo=UTC),
                source_table="gold.risk_features",
            ),
            FeatureRecord(
                entity_id="acct_1",
                feature_name="risk_score",
                feature_value=0.9,
                event_time=datetime(2026, 2, 20, 11, 50, tzinfo=UTC),
                available_at=datetime(2026, 2, 20, 13, 0, tzinfo=UTC),
                source_table="gold.risk_features",
            ),
        ],
    )

    assert snapshot.values["risk_score"] == 0.4


def test_point_in_time_build_dataset_per_entity_cutoff() -> None:
    extractor = PointInTimeFeatureExtractor()
    dataset = extractor.build_dataset(
        records=[
            FeatureRecord(
                entity_id="e1",
                feature_name="x",
                feature_value=1.0,
                event_time=datetime(2026, 2, 20, 9, 0, tzinfo=UTC),
                available_at=datetime(2026, 2, 20, 9, 10, tzinfo=UTC),
                source_table="silver.events",
            ),
            FeatureRecord(
                entity_id="e2",
                feature_name="x",
                feature_value=2.0,
                event_time=datetime(2026, 2, 20, 9, 0, tzinfo=UTC),
                available_at=datetime(2026, 2, 20, 9, 10, tzinfo=UTC),
                source_table="silver.events",
            ),
        ],
        entity_as_of={
            "e1": datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
            "e2": datetime(2026, 2, 20, 10, 0, tzinfo=UTC),
        },
    )
    assert len(dataset) == 2
    assert {item.entity_id for item in dataset} == {"e1", "e2"}

