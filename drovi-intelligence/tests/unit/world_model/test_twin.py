from datetime import UTC, datetime

from src.world_model import WorldEvent, WorldTwinMaterializer


def test_materialize_world_twin_snapshot_aggregates_internal_and_external_state() -> None:
    materializer = WorldTwinMaterializer()
    snapshot = materializer.materialize(
        organization_id="org_1",
        internal_objects=[
            {"id": "u1", "type": "decision", "entity_refs": ["acme"]},
            {"id": "u2", "type": "risk", "entity_id": "beta"},
        ],
        external_events=[
            WorldEvent(
                event_id="ev1",
                source="worldnews",
                observed_at=datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
                domain="legal",
                reliability=0.8,
                entity_refs=["acme"],
                payload={"title": "Acme targeted by new regulation"},
            ),
            {
                "event_id": "ev2",
                "source": "sec",
                "observed_at": datetime(2026, 2, 20, 14, 0, tzinfo=UTC),
                "domain": "finance",
                "reliability": 0.6,
                "entity_refs": ["beta"],
            },
        ],
    )

    as_dict = snapshot.to_dict()
    assert as_dict["internal_object_count"] == 2
    assert as_dict["external_event_count"] == 2
    assert as_dict["domain_pressure"]["legal"] == 0.8
    assert as_dict["entity_states"]["acme"]["pressure_score"] > as_dict["entity_states"]["beta"]["pressure_score"]


def test_compute_deltas_detects_domain_and_entity_pressure_changes() -> None:
    materializer = WorldTwinMaterializer()
    previous = materializer.materialize(
        organization_id="org_1",
        internal_objects=[{"id": "u1", "entity_refs": ["acme"]}],
        external_events=[
            {
                "event_id": "ev1",
                "source": "worldnews",
                "observed_at": datetime(2026, 2, 20, 12, 0, tzinfo=UTC),
                "domain": "legal",
                "reliability": 0.2,
                "entity_refs": ["acme"],
            }
        ],
    )
    current = materializer.materialize(
        organization_id="org_1",
        internal_objects=[{"id": "u1", "entity_refs": ["acme"]}],
        external_events=[
            {
                "event_id": "ev2",
                "source": "worldnews",
                "observed_at": datetime(2026, 2, 20, 15, 0, tzinfo=UTC),
                "domain": "legal",
                "reliability": 0.9,
                "entity_refs": ["acme"],
            }
        ],
    )

    deltas = materializer.compute_deltas(previous, current)
    payloads = [delta.to_dict() for delta in deltas]

    assert any(item["delta_type"] == "domain_pressure" and item["ref"] == "legal" for item in payloads)
    assert any(item["delta_type"] == "entity_pressure" and item["ref"] == "acme" for item in payloads)
