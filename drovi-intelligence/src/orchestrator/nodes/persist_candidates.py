"""
Persist Candidate Signals

Stores extracted candidates as raw signals for fast retrieval and later synthesis.
"""

import json
import time
from datetime import datetime
from uuid import uuid4

import structlog
from sqlalchemy import text

from ..state import IntelligenceState, NodeTiming
from src.db.client import get_db_session

logger = structlog.get_logger()


def _now() -> datetime:
    return datetime.utcnow()


async def persist_candidates_node(state: IntelligenceState) -> dict:
    start_time = time.time()
    state.trace.current_node = "persist_candidates"
    state.trace.nodes.append("persist_candidates")

    extracted = state.extracted
    if not extracted:
        return {}

    candidates = []

    for claim in extracted.claims:
        candidates.append({
            "candidate_type": "claim",
            "title": claim.content,
            "content": claim.content,
            "evidence_text": claim.quoted_text,
            "confidence": claim.confidence,
            "source_message_id": claim.source_message_id,
            "raw": claim.model_dump(),
        })

    for commitment in extracted.commitments:
        candidates.append({
            "candidate_type": "commitment",
            "title": commitment.title,
            "content": commitment.description or commitment.title,
            "evidence_text": commitment.quoted_text,
            "confidence": commitment.confidence,
            "source_message_id": commitment.claim_id,
            "raw": commitment.model_dump(),
        })

    for decision in extracted.decisions:
        candidates.append({
            "candidate_type": "decision",
            "title": decision.title,
            "content": decision.statement,
            "evidence_text": decision.quoted_text,
            "confidence": decision.confidence,
            "source_message_id": decision.claim_id,
            "raw": decision.model_dump(),
        })

    for task in extracted.tasks:
        candidates.append({
            "candidate_type": "task",
            "title": task.title,
            "content": task.description or task.title,
            "evidence_text": task.quoted_text,
            "confidence": task.confidence,
            "source_message_id": task.source_message_id,
            "raw": task.model_dump(),
        })

    for risk in extracted.risks:
        candidates.append({
            "candidate_type": "risk",
            "title": risk.title,
            "content": risk.description,
            "evidence_text": risk.quoted_text,
            "confidence": risk.confidence,
            "source_message_id": None,
            "raw": risk.model_dump(),
        })

    if not candidates:
        return {}

    candidate_only = bool(state.input.candidate_only or state.routing.candidate_only)
    default_status = "new" if candidate_only else "processed"
    def _candidate_status(candidate_type: str) -> tuple[str, datetime | None]:
        if (
            candidate_only
            and candidate_type == "decision"
            and (state.input.source_type or "").lower() in {"meeting", "call", "recording", "transcript"}
        ):
            return "pending_confirmation", None
        if default_status == "processed":
            return default_status, _now()
        return default_status, None

    async with get_db_session() as session:
        for candidate in candidates:
            status_value, processed_at_value = _candidate_status(candidate["candidate_type"])
            await session.execute(
                text(
                    """
                    INSERT INTO signal_candidate (
                        id, organization_id, analysis_id,
                        candidate_type, title, content,
                        evidence_text, confidence,
                        conversation_id, source_type, source_id,
                        source_message_id, raw_payload, status, processed_at, created_at
                    ) VALUES (
                        :id, :organization_id, :analysis_id,
                        :candidate_type, :title, :content,
                        :evidence_text, :confidence,
                        :conversation_id, :source_type, :source_id,
                        :source_message_id, :raw_payload, :status, :processed_at, :created_at
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": state.input.organization_id,
                    "analysis_id": state.analysis_id,
                    "candidate_type": candidate["candidate_type"],
                    "title": candidate["title"],
                    "content": candidate["content"],
                    "evidence_text": candidate["evidence_text"],
                    "confidence": candidate["confidence"],
                    "conversation_id": state.input.conversation_id,
                    "source_type": state.input.source_type,
                    "source_id": state.input.source_id,
                    "source_message_id": candidate["source_message_id"],
                    "raw_payload": json.dumps(candidate["raw"]),
                    "status": status_value,
                    "processed_at": processed_at_value,
                    "created_at": _now(),
                },
            )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "candidates_persisted": True,
        "trace": {
            **state.trace.model_dump(),
            "node_timings": {
                **state.trace.node_timings,
                "persist_candidates": node_timing,
            },
        }
    }
