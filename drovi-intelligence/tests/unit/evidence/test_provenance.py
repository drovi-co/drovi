from src.evidence.provenance import (
    collect_subject_ids,
    validate_cross_object_provenance,
)


def test_validate_cross_object_provenance_accepts_high_stakes_with_evidence():
    result = validate_cross_object_provenance(
        {
            "organization_id": "org-1",
            "object_type": "impact_edge",
            "impact_edge_id": "impact-1",
            "evidence_links": [
                {
                    "evidence_artifact_id": "artifact-1",
                    "confidence": 0.9,
                }
            ],
        }
    )

    assert result.is_valid is True
    assert result.errors == []


def test_validate_cross_object_provenance_rejects_missing_required_fields():
    result = validate_cross_object_provenance({})

    assert result.is_valid is False
    assert "organization_id is required" in result.errors
    assert "object_type is required" in result.errors
    assert "at least one subject id key is required" in result.errors


def test_validate_cross_object_provenance_requires_evidence_for_high_stakes():
    result = validate_cross_object_provenance(
        {
            "organization_id": "org-1",
            "object_type": "intervention_plan",
            "intervention_plan_id": "plan-1",
            "evidence_links": [],
        }
    )

    assert result.is_valid is False
    assert "high-stakes object_type requires non-empty evidence_links" in result.errors


def test_validate_cross_object_provenance_rejects_invalid_link_payload():
    result = validate_cross_object_provenance(
        {
            "organization_id": "org-1",
            "object_type": "belief",
            "belief_id": "belief-1",
            "evidence_links": [
                {"confidence": 2},
                "invalid",
            ],
        }
    )

    assert result.is_valid is False
    assert "evidence_links must contain only objects" in result.errors
    assert "evidence_links[0] requires evidence_artifact_id or unified_event_id" in result.errors
    assert "evidence_links[0].confidence must be between 0 and 1" in result.errors


def test_collect_subject_ids_collects_unique_ids():
    ids = collect_subject_ids(
        [
            {"observation_id": "obs-1", "belief_id": "belief-1"},
            {"belief_id": "belief-1", "hypothesis_id": "hyp-1"},
            {"constraint_id": "constraint-1"},
        ]
    )

    assert ids == {"obs-1", "belief-1", "hyp-1", "constraint-1"}
