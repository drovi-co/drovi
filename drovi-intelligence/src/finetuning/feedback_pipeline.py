"""
Feedback-to-Model Pipeline.

Transforms user corrections into labeled training data and updates
organization-specific prompt personalization. Optionally triggers
fine-tuning jobs once enough corrected samples are collected.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

from src.config import get_settings
from src.personalization import OrgProfileUpdate, update_org_profile
from src.memory.service import get_memory_service
from src.graph.client import get_graph_client

from .collector import get_collector
from .dataset_builder import DatasetBuilder
from .schemas import TaskType

logger = structlog.get_logger()


_TASK_SYSTEM_PROMPTS = {
    TaskType.COMMITMENT_EXTRACTION: "You are an expert at extracting commitments from business communication.",
    TaskType.DECISION_EXTRACTION: "You are an expert at extracting decisions from business communication.",
    TaskType.CLAIM_EXTRACTION: "You are an expert at extracting factual claims from business communication.",
    TaskType.TASK_EXTRACTION: "You are an expert at extracting actionable tasks from business communication.",
    TaskType.RISK_DETECTION: "You are an expert at detecting risks in business communication.",
    TaskType.BRIEF_GENERATION: "You are an expert at summarizing business communication into a brief.",
}


def _map_task_type(uio_type: str) -> TaskType | None:
    mapping = {
        "commitment": TaskType.COMMITMENT_EXTRACTION,
        "decision": TaskType.DECISION_EXTRACTION,
        "claim": TaskType.CLAIM_EXTRACTION,
        "task": TaskType.TASK_EXTRACTION,
        "risk": TaskType.RISK_DETECTION,
        "brief": TaskType.BRIEF_GENERATION,
    }
    return mapping.get(uio_type.lower()) if uio_type else None


def _extract_terms(text: str) -> list[str]:
    if not text:
        return []
    # Capture title-cased phrases and ALLCAPS acronyms
    phrases = re.findall(r"\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3})\b", text)
    acronyms = re.findall(r"\b([A-Z]{2,6})\b", text)
    return list({*phrases, *acronyms})


def _build_messages(task_type: TaskType, evidence_text: str) -> list[dict[str, str]]:
    system = _TASK_SYSTEM_PROMPTS.get(task_type, "You are an expert extraction model.")
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"CONTENT:\n{evidence_text}"},
    ]


def _build_expected_output(
    uio_type: str,
    props: dict[str, Any],
    corrections: dict[str, Any],
    evidence_text: str,
) -> dict[str, Any]:
    def _get(*keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in corrections:
                return corrections[key]
            if key in props:
                return props[key]
        return default

    if uio_type == "commitment":
        return {
            "commitments": [
                {
                    "title": _get("canonical_title", "title", default="Untitled commitment"),
                    "description": _get("canonical_description", "description"),
                    "direction": _get("direction", default="owed_by_me"),
                    "priority": _get("priority", default="medium"),
                    "debtor_name": _get("debtorName"),
                    "debtor_email": _get("debtorEmail"),
                    "creditor_name": _get("creditorName"),
                    "creditor_email": _get("creditorEmail"),
                    "due_date": _get("dueDate", "due_date"),
                    "due_date_text": _get("dueDateText", "due_date_text"),
                    "is_conditional": _get("isConditional", "is_conditional", default=False),
                    "condition": _get("condition"),
                    "quoted_text": evidence_text,
                    "quoted_text_start": None,
                    "quoted_text_end": None,
                    "confidence": 1.0,
                }
            ]
        }

    if uio_type == "decision":
        return {
            "decisions": [
                {
                    "title": _get("canonical_title", "title", default="Untitled decision"),
                    "statement": _get("statement", "canonical_description", "description", default=""),
                    "rationale": _get("rationale"),
                    "decision_maker_name": _get("decisionMakerName"),
                    "decision_maker_email": _get("decisionMakerEmail"),
                    "status": _get("status", default="made"),
                    "quoted_text": evidence_text,
                    "quoted_text_start": None,
                    "quoted_text_end": None,
                    "confidence": 1.0,
                }
            ]
        }

    if uio_type == "claim":
        return {
            "claims": [
                {
                    "type": _get("claimType", "type", default="fact"),
                    "content": _get("canonical_description", "description", "content", default=""),
                    "quoted_text": evidence_text,
                    "quoted_text_start": None,
                    "quoted_text_end": None,
                    "confidence": 1.0,
                    "importance": _get("importance", default="medium"),
                }
            ]
        }

    if uio_type == "task":
        return {
            "tasks": [
                {
                    "title": _get("canonical_title", "title", default="Untitled task"),
                    "description": _get("canonical_description", "description"),
                    "assignee_name": _get("assigneeName"),
                    "assignee_email": _get("assigneeEmail"),
                    "due_date": _get("dueDate", "due_date"),
                    "priority": _get("priority", default="medium"),
                    "status": _get("status", default="todo"),
                    "project": _get("project"),
                    "quoted_text": evidence_text,
                    "quoted_text_start": None,
                    "quoted_text_end": None,
                    "confidence": 1.0,
                }
            ]
        }

    if uio_type == "risk":
        return {
            "risks": [
                {
                    "type": _get("riskType", "type", default="other"),
                    "title": _get("canonical_title", "title", default="Untitled risk"),
                    "description": _get("canonical_description", "description"),
                    "severity": _get("severity", default="medium"),
                    "suggested_action": _get("suggestedAction", "suggested_action"),
                    "quoted_text": evidence_text,
                    "quoted_text_start": None,
                    "quoted_text_end": None,
                    "confidence": 1.0,
                }
            ]
        }

    return {"items": []}


async def _fetch_uio_properties(organization_id: str, uio_id: str) -> dict[str, Any]:
    graph = await get_graph_client()
    result = await graph.query(
        """
        MATCH (u:UIO {id: $id, organizationId: $orgId})
        RETURN labels(u) as labels, properties(u) as props
        """,
        {"id": uio_id, "orgId": organization_id},
    )
    if not result:
        return {}
    return result[0].get("props", {}) | {"labels": result[0].get("labels", [])}


async def _fetch_evidence_text(organization_id: str, uio_id: str) -> str:
    memory = await get_memory_service(organization_id)
    evidence_map = await memory.get_uio_evidence([uio_id], limit_per_uio=3)
    evidence = evidence_map.get(uio_id) or []
    if not evidence:
        return ""
    snippets = [e.get("quoted_text") or "" for e in evidence if e.get("quoted_text")]
    return "\n".join(snippets)[:2000]


async def record_uio_correction(
    organization_id: str,
    uio_id: str,
    corrections: dict[str, Any],
    user_id: str,
    props: dict[str, Any] | None = None,
) -> TaskType | None:
    """Record a user correction as labeled training data and update org profile."""
    if props is None:
        props = await _fetch_uio_properties(organization_id, uio_id)

    labels = props.get("labels") or []
    uio_type = props.get("type")
    if not uio_type:
        for label in labels:
            if label in {"Commitment", "Decision", "Task", "Claim", "Risk"}:
                uio_type = label.lower()
                break

    if not uio_type:
        logger.warning("Unable to infer UIO type for correction", uio_id=uio_id)
        return None

    task_type = _map_task_type(uio_type)
    if not task_type:
        logger.warning("Unsupported UIO type for correction", uio_type=uio_type)
        return None

    evidence_text = await _fetch_evidence_text(organization_id, uio_id)
    if not evidence_text:
        evidence_text = props.get("description") or props.get("canonical_description") or ""

    expected_output = _build_expected_output(uio_type, props, corrections, evidence_text)
    messages = _build_messages(task_type, evidence_text)

    collector = get_collector()
    await collector.collect_correction(
        original_sample_id=uio_id,
        task_type=task_type,
        original_messages=messages,
        corrected_output=expected_output,
        correction_type="user_edit",
        corrected_by=user_id,
    )

    # Update organization profile with terms from corrections
    correction_text = " ".join(str(v) for v in corrections.values() if isinstance(v, str))
    terms = _extract_terms(correction_text)
    if terms:
        await update_org_profile(
            organization_id,
            OrgProfileUpdate(project_names=terms, jargon_terms=terms),
        )

    return task_type


def _feedback_state_path() -> Path:
    settings = get_settings()
    return Path(settings.training_data_path) / "feedback_state.json"


def _load_feedback_state() -> dict[str, Any]:
    path = _feedback_state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _save_feedback_state(state: dict[str, Any]) -> None:
    path = _feedback_state_path()
    path.write_text(json.dumps(state, indent=2))


async def maybe_trigger_finetune(task_type: TaskType) -> None:
    settings = get_settings()
    if not settings.feedback_finetune_enabled:
        return

    state = _load_feedback_state()
    last_count = state.get(task_type.value, 0)
    base_path = Path(settings.training_data_path) / task_type.value
    current_count = len(list(base_path.glob("*.json"))) if base_path.exists() else 0

    if current_count - last_count < settings.feedback_finetune_min_samples:
        return

    builder = DatasetBuilder()
    dataset = await builder.build_dataset(task_type=task_type, min_confidence=0.5)
    if dataset.train_count == 0:
        return

    if not settings.together_api_key:
        logger.warning("Fine-tune skipped: Together API key not configured")
        state[task_type.value] = current_count
        _save_feedback_state(state)
        return

    try:
        from .together_client import TogetherFineTuning
    except Exception as exc:
        logger.warning("Fine-tune client unavailable", error=str(exc))
        return

    fine_tuner = TogetherFineTuning(settings.together_api_key)
    training_file_id = fine_tuner.upload_dataset(Path(dataset.train_path))
    fine_tuner.create_finetuning_job(
        training_file_id=training_file_id,
        task_type=task_type,
        base_model=settings.default_model_balanced,
        suffix="drovi-feedback",
    )

    state[task_type.value] = current_count
    _save_feedback_state(state)
