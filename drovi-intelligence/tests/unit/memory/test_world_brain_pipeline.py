from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from src.memory.service import FalkorMemoryBackend, MemoryService
from src.memory.world_brain import WorldBrainDryRunInput, WorldBrainDryRunPipeline


pytestmark = pytest.mark.unit


def test_world_brain_pipeline_executes_all_layers() -> None:
    pipeline = WorldBrainDryRunPipeline()
    output = pipeline.execute(
        WorldBrainDryRunInput(
            organization_id="org_1",
            internal_objects=[
                {"id": "u1", "type": "commitment", "title": "Ship compliance update", "entity_refs": ["acme"]}
            ],
            external_events=[
                {
                    "event_id": "ev1",
                    "source": "worldnews",
                    "observed_at": datetime(2026, 2, 22, 10, 0, tzinfo=UTC),
                    "domain": "legal",
                    "reliability": 0.9,
                    "entity_refs": ["acme"],
                    "title": "New regulation update",
                }
            ],
            strategic_context={
                "constraints": [
                    {
                        "id": "constraint_1",
                        "title": "Max pressure",
                        "machine_rule": "fact:world.max_pressure <= 0.5",
                        "severity_on_breach": "high",
                    }
                ],
                "causal_edges": [
                    {
                        "id": "edge_1",
                        "source_ref": "acme",
                        "target_ref": "renewal_risk",
                        "sign": 1,
                        "strength": 0.8,
                        "confidence": 0.7,
                    }
                ],
                "outcomes": [
                    {
                        "id": "outcome_1",
                        "source_key": "worldnews",
                        "predicted_probability": 0.7,
                        "observed_outcome": 1,
                    }
                ],
            },
        )
    )

    assert output["summary"]["belief_count"] >= 1
    assert output["summary"]["hypothesis_count"] >= 1
    assert "twin_snapshot" in output
    assert "impact_bridges" in output
    assert "attention_queue" in output
    assert "interventions" in output


@pytest.mark.asyncio
async def test_memory_service_world_brain_dry_run_uses_recent_uios_when_not_provided() -> None:
    memory = MemoryService("org_1", FalkorMemoryBackend("org_1"))
    memory.get_recent_uios = AsyncMock(
        return_value=[
            {
                "id": "u1",
                "type": "decision",
                "title": "Monitor supply chain",
                "belief_state": "asserted",
                "entity_refs": ["acme"],
            }
        ]
    )

    result = await memory.run_world_brain_dry_run(
        external_events=[
            {
                "event_id": "ev1",
                "source": "sec",
                "observed_at": datetime(2026, 2, 22, 11, 0, tzinfo=UTC),
                "domain": "finance",
                "reliability": 0.75,
                "entity_refs": ["acme"],
            }
        ]
    )

    assert memory.get_recent_uios.called
    assert result["organization_id"] == "org_1"
    assert result["summary"]["belief_count"] >= 1
