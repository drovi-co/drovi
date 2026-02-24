"""Normative obligation evaluation and violation detection."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import json
import re
from typing import Any, Mapping
from uuid import uuid4

from src.kernel.time import utc_now
from src.normative.dsl import decode_obligation_dsl

_RULE_PATTERN = re.compile(r"^fact:(?P<path>[a-zA-Z0-9_\.]+)\s*(?P<op>==|!=|>=|<=|>|<|contains|in)\s*(?P<value>.+)$")


def _coerce_scalar(raw: str) -> Any:
    value = raw.strip().strip('"').strip("'")
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def _as_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]


@dataclass(slots=True)
class NormativeConstraint:
    constraint_id: str
    title: str
    machine_rule: str
    severity_on_breach: str = "medium"
    jurisdiction: str | None = None
    is_active: bool = True
    source_class: str = "policy"
    obligation_type: str = "must"
    scope_entities: list[str] = field(default_factory=list)
    scope_actions: list[str] = field(default_factory=list)
    pre_breach_threshold: float | None = None
    evidence_refs: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ViolationCandidate:
    violation_id: str
    constraint_id: str
    severity: str
    confidence: float
    status: str
    detected_at: datetime
    subject_entity_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "violation_id": self.violation_id,
            "constraint_id": self.constraint_id,
            "severity": self.severity,
            "confidence": round(self.confidence, 4),
            "status": self.status,
            "subject_entity_id": self.subject_entity_id,
            "detected_at": self.detected_at.isoformat(),
            "details": dict(self.details),
        }


class NormativeEngine:
    """Evaluates machine-checkable obligations against world/internal facts."""

    def evaluate(
        self,
        *,
        constraints: list[NormativeConstraint],
        facts: Mapping[str, Any],
    ) -> list[ViolationCandidate]:
        signals: list[ViolationCandidate] = []
        for constraint in constraints:
            if not constraint.is_active:
                continue

            parsed = self._parse_constraint_rules(constraint)
            if not parsed:
                signals.append(
                    ViolationCandidate(
                        violation_id=f"viol_{uuid4().hex[:12]}",
                        constraint_id=constraint.constraint_id,
                        severity=constraint.severity_on_breach,
                        confidence=0.35,
                        status="open",
                        detected_at=utc_now(),
                        subject_entity_id=(constraint.scope_entities[0] if constraint.scope_entities else None),
                        details={
                            "reason": "rule_parse_failure",
                            "machine_rule": constraint.machine_rule,
                            "scope_entities": list(constraint.scope_entities),
                            "scope_actions": list(constraint.scope_actions),
                        },
                    )
                )
                continue

            logic = str(parsed.get("logic") or "all").lower()
            clauses = list(parsed.get("clauses") or [])
            threshold = self._resolve_pre_breach_threshold(
                constraint=constraint,
                dsl_thresholds=parsed.get("thresholds") or {},
            )

            clause_results: list[dict[str, Any]] = []
            for clause in clauses:
                path = str(clause.get("path") or "")
                op = str(clause.get("operator") or "")
                expected = clause.get("value")
                actual = self._resolve_path(facts, path)
                satisfied = self._evaluate_condition(actual, op, expected)
                proximity = self._calculate_threshold_proximity(actual=actual, op=op, expected=expected)
                clause_results.append(
                    {
                        "path": path,
                        "operator": op,
                        "expected": expected,
                        "actual": actual,
                        "satisfied": satisfied,
                        "proximity": proximity,
                    }
                )

            if logic == "any":
                obligation_satisfied = any(item["satisfied"] for item in clause_results)
            else:
                obligation_satisfied = all(item["satisfied"] for item in clause_results)

            subject_entity_id = constraint.scope_entities[0] if constraint.scope_entities else None
            details_base = {
                "title": constraint.title,
                "source_class": constraint.source_class,
                "obligation_type": constraint.obligation_type,
                "jurisdiction": constraint.jurisdiction,
                "scope_entities": list(constraint.scope_entities),
                "scope_actions": list(constraint.scope_actions),
                "evidence_refs": list(constraint.evidence_refs),
                "logic": logic,
                "clauses": clause_results,
                "machine_rule": constraint.machine_rule,
                "dedupe_key": _safe_hash(
                    {
                        "constraint_id": constraint.constraint_id,
                        "status": "open" if not obligation_satisfied else "warning",
                        "scope_entities": constraint.scope_entities,
                        "scope_actions": constraint.scope_actions,
                        "clauses": [
                            {
                                "path": item.get("path"),
                                "operator": item.get("operator"),
                                "expected": item.get("expected"),
                                "actual": item.get("actual"),
                                "satisfied": item.get("satisfied"),
                            }
                            for item in clause_results
                        ],
                    }
                ),
            }

            if not obligation_satisfied:
                signals.append(
                    ViolationCandidate(
                        violation_id=f"viol_{uuid4().hex[:12]}",
                        constraint_id=constraint.constraint_id,
                        severity=constraint.severity_on_breach,
                        confidence=0.72,
                        status="open",
                        detected_at=utc_now(),
                        subject_entity_id=subject_entity_id,
                        details={
                            **details_base,
                            "reason": "breach",
                        },
                    )
                )
                continue

            warning_clause = self._select_pre_breach_clause(
                clause_results=clause_results,
                threshold=threshold,
            )
            if warning_clause is None:
                continue

            proximity = _clamp(float(warning_clause.get("proximity") or 0.0), 0.0, 1.0)
            signals.append(
                ViolationCandidate(
                    violation_id=f"warn_{uuid4().hex[:12]}",
                    constraint_id=constraint.constraint_id,
                    severity=self._warning_severity(constraint.severity_on_breach),
                    confidence=_clamp(0.55 + (0.35 * proximity), 0.0, 1.0),
                    status="warning",
                    detected_at=utc_now(),
                    subject_entity_id=subject_entity_id,
                    details={
                        **details_base,
                        "reason": "pre_breach",
                        "pre_breach_threshold": threshold,
                        "warning_clause": warning_clause,
                        "recommended_actions": self._recommend_prebreach_actions(
                            path=str(warning_clause.get("path") or ""),
                            op=str(warning_clause.get("operator") or ""),
                            expected=warning_clause.get("expected"),
                            actual=warning_clause.get("actual"),
                            scope_actions=constraint.scope_actions,
                        ),
                    },
                )
            )

        return signals

    def _parse_constraint_rules(self, constraint: NormativeConstraint) -> dict[str, Any] | None:
        dsl = decode_obligation_dsl(constraint.machine_rule)
        if dsl is not None:
            clauses = []
            for clause in list(dsl.get("clauses") or []):
                if not isinstance(clause, Mapping):
                    continue
                path = str(clause.get("path") or "").strip()
                op = str(clause.get("operator") or "").strip()
                if not path or not op:
                    continue
                clauses.append(
                    {
                        "path": path,
                        "operator": op,
                        "value": clause.get("value"),
                    }
                )
            if not clauses:
                return None
            return {
                "logic": str(dsl.get("logic") or "all").lower(),
                "clauses": clauses,
                "thresholds": dsl.get("thresholds") if isinstance(dsl.get("thresholds"), Mapping) else {},
            }

        parsed_legacy = self._parse_rule(constraint.machine_rule)
        if parsed_legacy is None:
            return None

        path, op, expected = parsed_legacy
        return {
            "logic": "all",
            "clauses": [
                {
                    "path": path,
                    "operator": op,
                    "value": expected,
                }
            ],
            "thresholds": {},
        }

    @staticmethod
    def _resolve_pre_breach_threshold(
        *,
        constraint: NormativeConstraint,
        dsl_thresholds: Mapping[str, Any],
    ) -> float:
        if constraint.pre_breach_threshold is not None:
            return _clamp(float(constraint.pre_breach_threshold), 0.0, 1.0)
        dsl_ratio = dsl_thresholds.get("pre_breach_ratio")
        if dsl_ratio is not None:
            return _clamp(float(dsl_ratio), 0.0, 1.0)
        severity_defaults = {
            "critical": 0.75,
            "high": 0.82,
            "medium": 0.9,
            "low": 0.95,
        }
        return severity_defaults.get(str(constraint.severity_on_breach or "medium").lower(), 0.9)

    @staticmethod
    def _select_pre_breach_clause(
        *,
        clause_results: list[dict[str, Any]],
        threshold: float,
    ) -> dict[str, Any] | None:
        candidates = [
            item
            for item in clause_results
            if item.get("satisfied")
            and item.get("proximity") is not None
            and float(item.get("proximity") or 0.0) >= threshold
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda item: float(item.get("proximity") or 0.0), reverse=True)
        return candidates[0]

    @staticmethod
    def _warning_severity(breach_severity: str) -> str:
        severity = str(breach_severity or "medium").lower()
        if severity == "critical":
            return "high"
        if severity == "high":
            return "medium"
        return "low"

    @staticmethod
    def _recommend_prebreach_actions(
        *,
        path: str,
        op: str,
        expected: Any,
        actual: Any,
        scope_actions: list[str],
    ) -> list[str]:
        recommendations: list[str] = []
        if scope_actions:
            recommendations.extend([f"Prioritize action: {action}" for action in scope_actions[:3]])

        if op in {"<=", "<"}:
            recommendations.append(f"Reduce `{path}` below {expected}; current={actual}.")
        elif op in {">=", ">"}:
            recommendations.append(f"Increase `{path}` above {expected}; current={actual}.")
        elif op == "contains":
            recommendations.append(f"Ensure `{path}` includes required marker `{expected}`.")
        elif op == "in":
            recommendations.append(f"Keep `{path}` within allowed values {expected}.")
        else:
            recommendations.append(f"Review obligation path `{path}` and enforce expected value {expected}.")

        recommendations.append("Attach supporting evidence and re-evaluate before breach window closes.")
        return recommendations

    @staticmethod
    def _parse_rule(rule: str) -> tuple[str, str, Any] | None:
        match = _RULE_PATTERN.match(rule.strip())
        if not match:
            return None
        path = str(match.group("path"))
        op = str(match.group("op"))
        raw_value = str(match.group("value"))

        if op == "in":
            values = [_coerce_scalar(item) for item in raw_value.split(",") if item.strip()]
            return path, op, values

        return path, op, _coerce_scalar(raw_value)

    @staticmethod
    def _resolve_path(facts: Mapping[str, Any], path: str) -> Any:
        cursor: Any = facts
        for token in path.split("."):
            if not isinstance(cursor, Mapping):
                return None
            cursor = cursor.get(token)
            if cursor is None:
                return None
        return cursor

    @staticmethod
    def _evaluate_condition(actual: Any, op: str, expected: Any) -> bool:
        if op == "==":
            return actual == expected
        if op == "!=":
            return actual != expected
        if op == "contains":
            if actual is None:
                return False
            return str(expected) in str(actual)
        if op == "in":
            if not isinstance(expected, list):
                return False
            return actual in expected

        actual_number = _as_number(actual)
        expected_number = _as_number(expected)
        if actual_number is None or expected_number is None:
            return False
        if op == ">":
            return actual_number > expected_number
        if op == ">=":
            return actual_number >= expected_number
        if op == "<":
            return actual_number < expected_number
        if op == "<=":
            return actual_number <= expected_number
        return False

    @staticmethod
    def _calculate_threshold_proximity(actual: Any, op: str, expected: Any) -> float | None:
        actual_number = _as_number(actual)
        expected_number = _as_number(expected)
        if actual_number is None or expected_number is None:
            return None

        if op in {"<=", "<"}:
            if expected_number <= 0:
                return None
            ratio = actual_number / expected_number
            return _clamp(ratio, 0.0, 1.0)
        if op in {">=", ">"}:
            if actual_number <= 0:
                return None
            ratio = expected_number / actual_number
            return _clamp(ratio, 0.0, 1.0)
        return None
