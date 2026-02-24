"""Kafka topology policies for partitioning, retention classes, and tiered storage."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class TopicTopology:
    topic: str
    partitions: int
    retention_class: str


@dataclass(frozen=True, slots=True)
class KafkaTopologyPolicy:
    partition_strategy: str
    replication_factor: int
    min_insync_replicas: int
    tiered_storage_enabled: bool
    topics: tuple[TopicTopology, ...]
    retention_classes: dict[str, dict[str, int]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "partition_strategy": self.partition_strategy,
            "replication_factor": self.replication_factor,
            "min_insync_replicas": self.min_insync_replicas,
            "tiered_storage_enabled": self.tiered_storage_enabled,
            "topics": [
                {
                    "topic": item.topic,
                    "partitions": item.partitions,
                    "retention_class": item.retention_class,
                }
                for item in self.topics
            ],
            "retention_classes": self.retention_classes,
        }


def _default_policy() -> KafkaTopologyPolicy:
    return KafkaTopologyPolicy(
        partition_strategy="by_org_and_signal_class",
        replication_factor=3,
        min_insync_replicas=2,
        tiered_storage_enabled=True,
        topics=(
            TopicTopology(topic="raw.connector.events", partitions=48, retention_class="hot"),
            TopicTopology(topic="normalized.records", partitions=48, retention_class="hot"),
            TopicTopology(topic="intelligence.pipeline.input", partitions=64, retention_class="warm"),
            TopicTopology(topic="drovi-intelligence", partitions=64, retention_class="warm"),
            TopicTopology(topic="graph.changes", partitions=48, retention_class="warm"),
        ),
        retention_classes={
            "hot": {"retention_hours": 72},
            "warm": {"retention_hours": 720},
            "cold": {"retention_hours": 4320},
        },
    )


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _load_yaml(path: Path) -> dict[str, Any] | None:
    try:
        import yaml  # type: ignore
    except Exception:
        return None
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return raw if isinstance(raw, dict) else None


def load_kafka_topology_policy(path: str | None = None) -> KafkaTopologyPolicy:
    config_path = Path(path) if path else Path(__file__).resolve().parents[2] / "config" / "kafka_topology.yaml"
    policy = _default_policy()
    if not config_path.exists():
        return policy

    parsed = _load_yaml(config_path)
    if parsed is None:
        return policy

    cluster = parsed.get("cluster") if isinstance(parsed.get("cluster"), dict) else {}
    topic_map = parsed.get("topics") if isinstance(parsed.get("topics"), dict) else {}
    retention = (
        parsed.get("retention_classes")
        if isinstance(parsed.get("retention_classes"), dict)
        else dict(policy.retention_classes)
    )

    topics: list[TopicTopology] = []
    for name, payload in topic_map.items():
        if not isinstance(payload, dict):
            continue
        topic = str(name).strip()
        if not topic:
            continue
        topics.append(
            TopicTopology(
                topic=topic,
                partitions=max(1, _safe_int(payload.get("partitions"), 12)),
                retention_class=str(payload.get("retention_class") or "warm"),
            )
        )
    if not topics:
        topics = list(policy.topics)

    return KafkaTopologyPolicy(
        partition_strategy=str(cluster.get("partition_strategy") or policy.partition_strategy),
        replication_factor=max(1, _safe_int(cluster.get("replication_factor"), policy.replication_factor)),
        min_insync_replicas=max(1, _safe_int(cluster.get("min_insync_replicas"), policy.min_insync_replicas)),
        tiered_storage_enabled=bool(cluster.get("tiered_storage_enabled", policy.tiered_storage_enabled)),
        topics=tuple(sorted(topics, key=lambda item: item.topic)),
        retention_classes={str(k): dict(v) for k, v in retention.items() if isinstance(v, dict)},
    )

