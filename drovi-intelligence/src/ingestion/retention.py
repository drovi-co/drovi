"""Retention class policy for ingestion layers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.config import get_settings


RetentionClass = Literal["raw_observation", "normalized_observation", "derived_feature"]


@dataclass(frozen=True)
class RetentionPolicy:
    retention_class: RetentionClass
    retention_days: int | None
    immutable: bool
    legal_hold: bool


def retention_policy_for(
    *,
    retention_class: RetentionClass,
    legal_hold: bool = False,
    high_stakes: bool = False,
) -> RetentionPolicy:
    settings = get_settings()
    if legal_hold or high_stakes:
        return RetentionPolicy(
            retention_class=retention_class,
            retention_days=None,
            immutable=True,
            legal_hold=True,
        )

    if retention_class == "raw_observation":
        return RetentionPolicy(
            retention_class=retention_class,
            retention_days=int(settings.retention_raw_observation_days),
            immutable=True,
            legal_hold=False,
        )
    if retention_class == "normalized_observation":
        return RetentionPolicy(
            retention_class=retention_class,
            retention_days=int(settings.retention_normalized_observation_days),
            immutable=True,
            legal_hold=False,
        )
    return RetentionPolicy(
        retention_class=retention_class,
        retention_days=int(settings.retention_derived_feature_days),
        immutable=False,
        legal_hold=False,
    )
