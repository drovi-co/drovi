"""Persistence accumulator for a single extraction batch."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class PersistResults:
    uios_created: list[dict[str, Any]] = field(default_factory=list)
    uios_merged: list[dict[str, Any]] = field(default_factory=list)
    tasks_created: list[dict[str, Any]] = field(default_factory=list)
    claims_created: list[dict[str, Any]] = field(default_factory=list)
    contacts_created: list[dict[str, Any]] = field(default_factory=list)
    created_uio_by_extracted_id: dict[str, dict[str, Any]] = field(default_factory=dict)

