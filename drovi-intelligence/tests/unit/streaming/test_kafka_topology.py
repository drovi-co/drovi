from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from src.streaming.kafka_topology import load_kafka_topology_policy

pytestmark = [pytest.mark.unit]


def test_kafka_topology_loads_defaults_when_config_missing() -> None:
    policy = load_kafka_topology_policy(path="/tmp/does-not-exist-kafka-topology.yaml")
    assert policy.replication_factor >= 1
    assert len(policy.topics) > 0
    assert policy.tiered_storage_enabled is True


def test_kafka_topology_loads_custom_policy() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        path = Path(tmp_dir) / "kafka_topology.yaml"
        path.write_text(
            "\n".join(
                [
                    "cluster:",
                    "  partition_strategy: by_org",
                    "  replication_factor: 2",
                    "  min_insync_replicas: 1",
                    "  tiered_storage_enabled: false",
                    "topics:",
                    "  custom.topic:",
                    "    partitions: 24",
                    "    retention_class: warm",
                ]
            ),
            encoding="utf-8",
        )
        policy = load_kafka_topology_policy(path=str(path))

    assert policy.partition_strategy == "by_org"
    assert policy.replication_factor == 2
    assert policy.min_insync_replicas == 1
    assert policy.tiered_storage_enabled is False
    assert policy.topics[0].topic == "custom.topic"
