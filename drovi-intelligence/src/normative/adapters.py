"""Parser adapters for legal/policy/contract obligation sources."""

from __future__ import annotations

import re
from typing import Any

from src.normative.dsl import ObligationClause, ObligationDSL, ObligationScope, ObligationThresholds
from src.normative.engine import NormativeConstraint

_RE_MAX = re.compile(r"(?:must\\s+not\\s+exceed|no\\s+more\\s+than|at\\s+most)\\s+(?P<value>[-+]?[0-9]+(?:\\.[0-9]+)?)", re.IGNORECASE)
_RE_MIN = re.compile(r"(?:at\\s+least|no\\s+less\\s+than|minimum\\s+of)\\s+(?P<value>[-+]?[0-9]+(?:\\.[0-9]+)?)", re.IGNORECASE)
_RE_DEADLINE = re.compile(r"(?:within|no\\s+later\\s+than)\\s+(?P<value>[0-9]+)\\s+days?", re.IGNORECASE)
_RE_CONTAINS = re.compile(r"(?:must\\s+include|shall\\s+include)\\s+(?P<value>[A-Za-z0-9_\\-\\s]+)", re.IGNORECASE)


def _coerce_numeric(text: str) -> float | int:
    if "." in text:
        return float(text)
    return int(text)


def _extract_clause_from_text(*, clause_text: str, fact_path: str) -> ObligationClause | None:
    content = str(clause_text or "").strip()
    if not content:
        return None

    max_match = _RE_MAX.search(content)
    if max_match:
        return ObligationClause(path=fact_path, operator="<=", value=_coerce_numeric(max_match.group("value")))

    min_match = _RE_MIN.search(content)
    if min_match:
        return ObligationClause(path=fact_path, operator=">=", value=_coerce_numeric(min_match.group("value")))

    deadline_match = _RE_DEADLINE.search(content)
    if deadline_match:
        return ObligationClause(
            path=fact_path,
            operator="<=",
            value=int(deadline_match.group("value")),
        )

    contains_match = _RE_CONTAINS.search(content)
    if contains_match:
        return ObligationClause(path=fact_path, operator="contains", value=contains_match.group("value").strip())

    return None


def _default_scope(payload: dict[str, Any]) -> ObligationScope:
    return ObligationScope(
        entities=[str(item) for item in list(payload.get("scope_entities") or payload.get("entity_refs") or []) if item],
        actions=[str(item) for item in list(payload.get("scope_actions") or payload.get("action_refs") or []) if item],
        jurisdictions=[str(item) for item in list(payload.get("jurisdictions") or []) if item],
    )


def _default_thresholds(payload: dict[str, Any]) -> ObligationThresholds:
    return ObligationThresholds(
        pre_breach_ratio=float(payload.get("pre_breach_ratio") or 0.9),
        warning_confidence_floor=float(payload.get("warning_confidence_floor") or 0.55),
    )


def _build_constraint_from_payload(payload: dict[str, Any], *, source_class: str) -> NormativeConstraint:
    machine_rule = payload.get("machine_rule")
    if machine_rule:
        return NormativeConstraint(
            constraint_id=str(payload.get("constraint_id") or payload.get("id") or ""),
            title=str(payload.get("title") or payload.get("name") or "constraint"),
            machine_rule=str(machine_rule),
            severity_on_breach=str(payload.get("severity_on_breach") or payload.get("severity") or "medium"),
            jurisdiction=payload.get("jurisdiction"),
            is_active=bool(payload.get("is_active", True)),
            source_class=source_class,
            obligation_type=str(payload.get("obligation_type") or "must"),
            scope_entities=[str(item) for item in list(payload.get("scope_entities") or payload.get("entity_refs") or []) if item],
            scope_actions=[str(item) for item in list(payload.get("scope_actions") or payload.get("action_refs") or []) if item],
            pre_breach_threshold=float(payload.get("pre_breach_threshold")) if payload.get("pre_breach_threshold") is not None else None,
            evidence_refs=[str(item) for item in list(payload.get("evidence_refs") or []) if item],
        )

    fact_path = str(payload.get("fact_path") or "subject.metric")
    clauses: list[ObligationClause] = []

    explicit_clause = payload.get("clause")
    if isinstance(explicit_clause, dict):
        clauses.append(
            ObligationClause(
                path=str(explicit_clause.get("path") or fact_path),
                operator=str(explicit_clause.get("operator") or "<="),
                value=explicit_clause.get("value"),
            )
        )
    else:
        inferred = _extract_clause_from_text(
            clause_text=str(payload.get("clause_text") or payload.get("text") or payload.get("title") or ""),
            fact_path=fact_path,
        )
        if inferred is not None:
            clauses.append(inferred)

    if not clauses:
        default_operator = str(payload.get("operator") or "<=")
        default_value = payload.get("value", payload.get("threshold_value", 1))
        clauses.append(
            ObligationClause(
                path=fact_path,
                operator=default_operator,
                value=default_value,
            )
        )

    dsl = ObligationDSL(
        source_class=source_class,
        obligation_type=str(payload.get("obligation_type") or "must"),
        logic=str(payload.get("logic") or "all"),
        clauses=clauses,
        scope=_default_scope(payload),
        thresholds=_default_thresholds(payload),
        evidence_refs=[str(item) for item in list(payload.get("evidence_refs") or []) if item],
        metadata={
            "source_id": payload.get("source_id"),
            "source_type": payload.get("source_type"),
            "source_ref": payload.get("source_ref"),
            "summary": payload.get("summary"),
        },
    )

    return NormativeConstraint(
        constraint_id=str(payload.get("constraint_id") or payload.get("id") or ""),
        title=str(payload.get("title") or payload.get("name") or f"{source_class}_constraint"),
        machine_rule=dsl.encode(),
        severity_on_breach=str(payload.get("severity_on_breach") or payload.get("severity") or "medium"),
        jurisdiction=payload.get("jurisdiction"),
        is_active=bool(payload.get("is_active", True)),
        source_class=source_class,
        obligation_type=str(payload.get("obligation_type") or "must"),
        scope_entities=dsl.scope.entities,
        scope_actions=dsl.scope.actions,
        pre_breach_threshold=float(payload.get("pre_breach_threshold")) if payload.get("pre_breach_threshold") is not None else dsl.thresholds.pre_breach_ratio,
        evidence_refs=dsl.evidence_refs,
    )


def parse_legal_constraint(payload: dict[str, Any]) -> NormativeConstraint:
    return _build_constraint_from_payload(payload, source_class="legal")


def parse_policy_constraint(payload: dict[str, Any]) -> NormativeConstraint:
    return _build_constraint_from_payload(payload, source_class="policy")


def parse_contract_constraint(payload: dict[str, Any]) -> NormativeConstraint:
    return _build_constraint_from_payload(payload, source_class="contract")


def parse_normative_source(payload: dict[str, Any]) -> NormativeConstraint:
    source_class = str(payload.get("source_class") or payload.get("origin_type") or "policy").strip().lower()
    if source_class in {"legal", "regulation", "law"}:
        return parse_legal_constraint(payload)
    if source_class in {"contract", "msa", "sow", "agreement"}:
        return parse_contract_constraint(payload)
    return parse_policy_constraint(payload)
