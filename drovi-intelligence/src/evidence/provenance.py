"""Cross-object provenance validation for cognitive objects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

HIGH_STAKES_OBJECT_TYPES = {
    "belief",
    "constraint_violation_candidate",
    "impact_edge",
    "intervention_plan",
    "realized_outcome",
}

SUPPORTED_SUBJECT_KEYS = (
    "observation_id",
    "belief_id",
    "hypothesis_id",
    "constraint_id",
    "impact_edge_id",
    "intervention_plan_id",
    "realized_outcome_id",
)


@dataclass(frozen=True)
class ProvenanceValidationResult:
    is_valid: bool
    errors: list[str]


def _validate_link(link: dict[str, Any], index: int) -> list[str]:
    errors: list[str] = []

    if not (link.get("evidence_artifact_id") or link.get("unified_event_id")):
        errors.append(f"evidence_links[{index}] requires evidence_artifact_id or unified_event_id")

    confidence = link.get("confidence")
    if confidence is not None:
        try:
            value = float(confidence)
        except (TypeError, ValueError):
            errors.append(f"evidence_links[{index}].confidence must be numeric")
        else:
            if value < 0.0 or value > 1.0:
                errors.append(f"evidence_links[{index}].confidence must be between 0 and 1")

    return errors


def validate_cross_object_provenance(payload: dict[str, Any]) -> ProvenanceValidationResult:
    """Validate provenance payload structure for cognitive object persistence.

    Expected payload keys:
    - organization_id
    - object_type
    - one of supported subject keys
    - evidence_links (required for high-stakes object types)
    """

    errors: list[str] = []

    organization_id = payload.get("organization_id")
    if not organization_id:
        errors.append("organization_id is required")

    object_type = str(payload.get("object_type") or "").strip()
    if not object_type:
        errors.append("object_type is required")

    if not any(payload.get(key) for key in SUPPORTED_SUBJECT_KEYS):
        errors.append("at least one subject id key is required")

    raw_links = payload.get("evidence_links")
    evidence_links: list[dict[str, Any]]
    if raw_links is None:
        evidence_links = []
    elif isinstance(raw_links, list):
        evidence_links = [link for link in raw_links if isinstance(link, dict)]
        if len(evidence_links) != len(raw_links):
            errors.append("evidence_links must contain only objects")
    else:
        evidence_links = []
        errors.append("evidence_links must be a list")

    if object_type in HIGH_STAKES_OBJECT_TYPES and not evidence_links:
        errors.append("high-stakes object_type requires non-empty evidence_links")

    for idx, link in enumerate(evidence_links):
        errors.extend(_validate_link(link, idx))

    return ProvenanceValidationResult(is_valid=len(errors) == 0, errors=errors)


def collect_subject_ids(payloads: Iterable[dict[str, Any]]) -> set[str]:
    """Collect all subject ids from an iterable of provenance payloads."""

    ids: set[str] = set()
    for payload in payloads:
        for key in SUPPORTED_SUBJECT_KEYS:
            value = payload.get(key)
            if value:
                ids.add(str(value))
    return ids
