from src.continuum.dsl import ContinuumDefinition, compute_definition_hash


def test_continuum_definition_hash_stable():
    definition = ContinuumDefinition.model_validate(
        {
            "name": "Renewals Watch",
            "goal": "Monitor renewal risk",
            "schedule": {"type": "interval", "interval_minutes": 30},
            "steps": [
                {"id": "scan", "name": "Scan", "action": "workflow:risk_analysis", "inputs": {}},
            ],
        }
    )
    hash1 = compute_definition_hash(definition)
    hash2 = compute_definition_hash(definition)
    assert hash1 == hash2


def test_continuum_definition_requires_steps():
    try:
        ContinuumDefinition.model_validate({"name": "No Steps", "goal": "Fail"})
    except Exception as exc:
        assert "steps" in str(exc)
    else:
        raise AssertionError("Expected validation error for missing steps")
