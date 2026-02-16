"""Thin input envelope for UIO truth persistence.

This intentionally contains only primitives + untyped message shapes so the
UIO Truth context does not depend on orchestrator state models.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class PersistEnvelope:
    organization_id: str
    source_type: str | None
    source_account_id: str | None
    conversation_id: str | None
    source_id: str | None
    analysis_id: str
    messages: Sequence[Any]
    input_content: str | None

    def session_id(self) -> str | None:
        return self.source_id or self.conversation_id

