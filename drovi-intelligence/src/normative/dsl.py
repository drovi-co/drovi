"""Normalized DSL for machine-checkable obligations."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any


_SUPPORTED_OPERATORS = {"==", "!=", ">=", "<=", ">", "<", "contains", "in"}


def _coerce_scalar(raw: Any) -> Any:
    if isinstance(raw, (bool, int, float)) or raw is None:
        return raw
    if isinstance(raw, list):
        return [_coerce_scalar(item) for item in raw]
    value = str(raw).strip().strip('"').strip("'")
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


@dataclass(slots=True)
class ObligationClause:
    path: str
    operator: str
    value: Any

    def to_dict(self) -> dict[str, Any]:
        op = str(self.operator).strip()
        if op not in _SUPPORTED_OPERATORS:
            raise ValueError(f"Unsupported operator: {op}")
        return {
            "path": str(self.path).strip(),
            "operator": op,
            "value": _coerce_scalar(self.value),
        }


@dataclass(slots=True)
class ObligationScope:
    entities: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    jurisdictions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entities": [str(item) for item in self.entities if item],
            "actions": [str(item) for item in self.actions if item],
            "jurisdictions": [str(item) for item in self.jurisdictions if item],
        }


@dataclass(slots=True)
class ObligationThresholds:
    pre_breach_ratio: float = 0.9
    warning_confidence_floor: float = 0.55

    def to_dict(self) -> dict[str, float]:
        return {
            "pre_breach_ratio": max(0.0, min(float(self.pre_breach_ratio), 1.0)),
            "warning_confidence_floor": max(0.0, min(float(self.warning_confidence_floor), 1.0)),
        }


@dataclass(slots=True)
class ObligationDSL:
    source_class: str
    obligation_type: str
    logic: str = "all"
    clauses: list[ObligationClause] = field(default_factory=list)
    scope: ObligationScope = field(default_factory=ObligationScope)
    thresholds: ObligationThresholds = field(default_factory=ObligationThresholds)
    evidence_refs: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    version: str = "1.0"

    def to_dict(self) -> dict[str, Any]:
        logic = str(self.logic or "all").strip().lower()
        if logic not in {"all", "any"}:
            logic = "all"
        return {
            "version": str(self.version or "1.0"),
            "source_class": str(self.source_class or "policy").strip().lower(),
            "obligation_type": str(self.obligation_type or "must").strip().lower(),
            "logic": logic,
            "clauses": [item.to_dict() for item in self.clauses if item.path],
            "scope": self.scope.to_dict(),
            "thresholds": self.thresholds.to_dict(),
            "evidence_refs": [str(item) for item in self.evidence_refs if item],
            "metadata": dict(self.metadata or {}),
        }

    def encode(self) -> str:
        return "dsl:" + json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))


def decode_obligation_dsl(rule: str) -> dict[str, Any] | None:
    if not isinstance(rule, str):
        return None
    text = rule.strip()
    if not text.lower().startswith("dsl:"):
        return None
    payload = text[4:].strip()
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed
