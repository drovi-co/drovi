from src.world_model.exposure import ExposureTopologyEngine


def test_build_graph_includes_core_exposure_dimensions_and_overlay() -> None:
    engine = ExposureTopologyEngine()
    graph = engine.build_graph(
        internal_objects=[
            {
                "id": "obj_1",
                "type": "commitment",
                "entity_refs": ["acme"],
                "counterparty_refs": ["vendor_a"],
                "asset_refs": ["portfolio_semis"],
                "dependency_refs": ["chip_supply"],
                "materiality": 0.9,
            }
        ],
        risk_overlay={
            "default_multiplier": 1.1,
            "entity_multipliers": {"chip_supply": 1.2},
            "edge_type_multipliers": {"dependency": 1.3},
            "propagation_limits": {"dependency": 5},
        },
    )

    assert graph.edges
    dependency_edges = [edge for edge in graph.edges if edge.edge_type == "dependency"]
    assert dependency_edges
    assert any(edge.propagation_limit == 5 for edge in dependency_edges)
    assert any(edge.risk_multiplier > 1.1 for edge in dependency_edges)


def test_project_external_shock_respects_propagation_limit() -> None:
    engine = ExposureTopologyEngine()
    graph = engine.build_graph(
        internal_objects=[
            {
                "id": "obj_root",
                "type": "risk",
                "entity_refs": ["entity_a"],
                "dependency_refs": ["dep_x"],
                "materiality": 0.8,
            },
            {
                "id": "obj_parent",
                "type": "commitment",
                "materiality": 0.75,
                "exposure_edges": [
                    {
                        "source_ref": "obj_parent",
                        "target_ref": "entity_a",
                        "edge_type": "custom",
                        "weight": 0.9,
                        "propagation_limit": 1,
                    }
                ],
            },
        ],
    )

    scores = engine.project_external_shock(
        graph=graph,
        external_refs=["dep_x"],
        max_depth=4,
    )

    assert scores.get("obj_root", 0.0) > 0.0
    # This path would require depth=2 via entity_a and is blocked by propagation_limit=1.
    assert "obj_parent" not in scores
