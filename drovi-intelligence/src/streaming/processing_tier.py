"""Dedicated stream processing tier for high-volume transform workloads."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class ProcessingClass(str, Enum):
    CRITICAL = "critical"
    HIGH_VOLUME = "high_volume"
    STANDARD = "standard"


@dataclass(frozen=True, slots=True)
class ProcessingTierDecision:
    processing_class: ProcessingClass
    worker_pool: str
    batch_size: int
    max_concurrency: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "processing_class": self.processing_class.value,
            "worker_pool": self.worker_pool,
            "batch_size": self.batch_size,
            "max_concurrency": self.max_concurrency,
        }


class StreamProcessingTier:
    """Routes events into stream processing lanes with bounded concurrency."""

    def route(
        self,
        *,
        topic: str,
        payload: dict[str, Any],
        backlog_depth: int = 0,
    ) -> ProcessingTierDecision:
        priority = int(payload.get("priority") or payload.get("ingest_priority") or 5)
        source_type = str(payload.get("source_type") or payload.get("connector_type") or "").lower()
        is_crawl = topic.startswith("crawl.")
        backlog = max(0, int(backlog_depth))

        if priority <= 1:
            return ProcessingTierDecision(
                processing_class=ProcessingClass.CRITICAL,
                worker_pool="stream-critical",
                batch_size=32,
                max_concurrency=24 if backlog > 1000 else 16,
            )

        if is_crawl or source_type in {"worldnewsapi", "rss_osint", "sec_edgar"}:
            return ProcessingTierDecision(
                processing_class=ProcessingClass.HIGH_VOLUME,
                worker_pool="stream-high-volume",
                batch_size=128 if backlog > 5000 else 96,
                max_concurrency=48 if backlog > 5000 else 32,
            )

        return ProcessingTierDecision(
            processing_class=ProcessingClass.STANDARD,
            worker_pool="stream-standard",
            batch_size=64,
            max_concurrency=16 if backlog > 1000 else 8,
        )

