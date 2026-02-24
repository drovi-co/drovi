"""Hot/Warm/Cold lifecycle automation for lakehouse partitions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str) and value.strip():
        normalized = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except Exception:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


@dataclass(frozen=True, slots=True)
class LifecycleTransition:
    partition_key: str
    table_name: str
    from_class: str
    to_class: str
    age_days: int
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "partition_key": self.partition_key,
            "table_name": self.table_name,
            "from_class": self.from_class,
            "to_class": self.to_class,
            "age_days": self.age_days,
            "reason": self.reason,
        }


class LakehouseLifecycleManager:
    """Computes lifecycle class transitions for partition storage tiers."""

    def __init__(
        self,
        *,
        warm_after_days: int = 7,
        cold_after_days: int = 30,
    ) -> None:
        self._warm_after_days = max(1, int(warm_after_days))
        self._cold_after_days = max(self._warm_after_days + 1, int(cold_after_days))

    def classify_age(self, *, age_days: int) -> str:
        if age_days >= self._cold_after_days:
            return "cold"
        if age_days >= self._warm_after_days:
            return "warm"
        return "hot"

    def plan_transitions(
        self,
        *,
        partitions: list[dict[str, Any]],
        now: datetime | None = None,
    ) -> list[LifecycleTransition]:
        now_utc = _parse_datetime(now) or datetime.now(UTC)
        transitions: list[LifecycleTransition] = []
        for item in partitions:
            last_event_at = _parse_datetime(item.get("last_event_at")) or _parse_datetime(item.get("updated_at"))
            if last_event_at is None:
                continue
            age_days = max(0, int((now_utc - last_event_at).total_seconds() // (24 * 3600)))
            desired_class = self.classify_age(age_days=age_days)
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            current_class = str(metadata.get("storage_class") or "hot")
            if current_class == desired_class:
                continue
            transitions.append(
                LifecycleTransition(
                    partition_key=str(item.get("partition_key") or ""),
                    table_name=str(item.get("table_name") or ""),
                    from_class=current_class,
                    to_class=desired_class,
                    age_days=age_days,
                    reason=f"age_days={age_days} requires {desired_class} tier",
                )
            )
        return transitions

