"""Policy rule engine for guardrail decisions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import structlog
from pydantic import BaseModel, Field

from src.config import get_settings
from .schemas import GuardrailAction, PolicyDecision, SeverityLevel

logger = structlog.get_logger()

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


class PolicyRule(BaseModel):
    id: str
    name: str
    action: GuardrailAction
    severity: SeverityLevel
    applies_to: Literal["inbound", "outbound", "both"] = "both"
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    description: str | None = None


@dataclass
class PolicyContext:
    direction: Literal["inbound", "outbound"]
    channel: str | None
    pii_types: list[str]
    contradiction_severity: SeverityLevel | None
    fraud_score: float | None


def _load_rules_from_json(payload: str) -> list[PolicyRule]:
    try:
        data = json.loads(payload)
        return [PolicyRule.model_validate(item) for item in data]
    except Exception as exc:
        logger.warning("Failed to parse policy rules JSON", error=str(exc))
        return []


def _load_rules_from_path(path: str) -> list[PolicyRule]:
    try:
        content = Path(path).read_text()
    except Exception as exc:
        logger.warning("Failed to read policy rules file", error=str(exc))
        return []
    return _load_rules_from_json(content)


def _default_rules() -> list[PolicyRule]:
    return [
        PolicyRule(
            id="block_sensitive_pii",
            name="Block SSN/Credit Card",
            action="block",
            severity="critical",
            applies_to="outbound",
            conditions=[{"field": "pii_types", "operator": "contains_any", "value": ["ssn", "credit_card"]}],
            description="Block outbound messages containing SSNs or credit card numbers.",
        ),
        PolicyRule(
            id="require_approval_contact_pii",
            name="Approve Email/Phone Sharing",
            action="require_approval",
            severity="medium",
            applies_to="outbound",
            conditions=[{"field": "pii_types", "operator": "contains_any", "value": ["email", "phone"]}],
            description="Require approval before sharing contact PII externally.",
        ),
        PolicyRule(
            id="require_approval_contradiction",
            name="Approve High Contradictions",
            action="require_approval",
            severity="high",
            applies_to="outbound",
            conditions=[{"field": "contradiction_severity", "operator": "gte", "value": "high"}],
            description="Require approval when draft contradicts existing commitments/decisions.",
        ),
        PolicyRule(
            id="block_fraud_high",
            name="Block High Fraud Risk",
            action="block",
            severity="critical",
            applies_to="inbound",
            conditions=[{"field": "fraud_score", "operator": "gte", "value": 0.85}],
            description="Block inbound messages with very high fraud risk.",
        ),
        PolicyRule(
            id="require_approval_fraud_medium",
            name="Approve Fraud Risk",
            action="require_approval",
            severity="high",
            applies_to="inbound",
            conditions=[{"field": "fraud_score", "operator": "gte", "value": 0.6}],
            description="Require approval when fraud risk is elevated.",
        ),
    ]


def load_policy_rules() -> list[PolicyRule]:
    settings = get_settings()
    rules: list[PolicyRule] = []

    if settings.policy_rules_json:
        rules.extend(_load_rules_from_json(settings.policy_rules_json))
    elif settings.policy_rules_path:
        rules.extend(_load_rules_from_path(settings.policy_rules_path))

    if settings.policy_default_rules_enabled:
        rules.extend(_default_rules())

    return rules


def _evaluate_condition(
    field: str,
    operator: str,
    value: Any,
    context: PolicyContext,
) -> bool:
    field_value: Any
    if field == "pii_types":
        field_value = context.pii_types
    elif field == "fraud_score":
        field_value = context.fraud_score or 0.0
    elif field == "contradiction_severity":
        field_value = context.contradiction_severity or "low"
    elif field == "channel":
        field_value = context.channel or ""
    else:
        return False

    if operator == "contains_any":
        if not isinstance(field_value, list):
            return False
        return any(item in field_value for item in value)
    if operator == "gte":
        if field == "contradiction_severity":
            return _SEVERITY_RANK.get(field_value, 0) >= _SEVERITY_RANK.get(value, 0)
        return float(field_value) >= float(value)
    if operator == "equals":
        return field_value == value
    if operator == "in":
        return field_value in value
    return False


def evaluate_policy(context: PolicyContext, rules: list[PolicyRule] | None = None) -> list[PolicyDecision]:
    """Evaluate policy rules against the current guardrail context."""
    rules = rules or load_policy_rules()
    decisions: list[PolicyDecision] = []

    for rule in rules:
        if rule.applies_to not in ("both", context.direction):
            continue

        if all(
            _evaluate_condition(condition.get("field", ""), condition.get("operator", ""), condition.get("value"), context)
            for condition in rule.conditions
        ):
            decisions.append(
                PolicyDecision(
                    rule_id=rule.id,
                    action=rule.action,
                    severity=rule.severity,
                    reason=rule.description or rule.name,
                )
            )

    return decisions
