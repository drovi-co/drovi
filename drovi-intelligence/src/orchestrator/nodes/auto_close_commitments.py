"""
Auto Close Commitments Node

Detects explicit fulfillment of existing commitments and auto-closes them
with evidence-linked timeline entries.
"""

from __future__ import annotations

import re
import time
import json
from datetime import datetime, timezone
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.llm import get_llm_service, CommitmentFulfillmentOutput
from src.llm.prompts_v2 import get_commitment_fulfillment_prompt
from src.orchestrator.utils.extraction import find_quote_span
from ..state import IntelligenceState, NodeTiming, LLMCall

logger = structlog.get_logger()

COMPLETION_PATTERNS = re.compile(
    r"\b(sent|delivered|submitted|completed|finished|shipped|resolved|fixed|closed|approved|paid|signed|uploaded|shared)\b",
    re.IGNORECASE,
)


def _tokenize(text: str) -> set[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    return {t for t in cleaned.split() if t}


def _similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a), len(b))


async def auto_close_commitments_node(state: IntelligenceState) -> dict:
    """Detect and close fulfilled commitments based on new evidence."""
    start_time = time.time()
    state.trace.current_node = "auto_close_commitments"
    state.trace.nodes.append("auto_close_commitments")

    content = state.input.content or ""
    if not content.strip() or not COMPLETION_PATTERNS.search(content):
        return {
            "trace": {
                **state.trace.model_dump(),
                "node_timings": {
                    **state.trace.node_timings,
                    "auto_close_commitments": NodeTiming(
                        started_at=start_time,
                        completed_at=time.time(),
                    ),
                },
            },
        }

    org_id = state.input.organization_id
    if not org_id:
        return {}

    created_commitment_ids = {
        uio.get("id")
        for uio in (state.output.uios_created or [])
        if uio.get("type") == "commitment"
    }

    # Fetch open commitments from Postgres
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT u.id, u.canonical_title, u.canonical_description,
                       u.due_date, cd.status as commitment_status
                FROM unified_intelligence_object u
                JOIN uio_commitment_details cd ON cd.uio_id = u.id
                WHERE u.organization_id = :org_id
                  AND u.type = 'commitment'
                  AND u.status IN ('active', 'in_progress')
                  AND cd.status NOT IN ('completed', 'cancelled')
                """
            ),
            {"org_id": org_id},
        )
        rows = result.fetchall()

    if not rows:
        return {}

    content_tokens = _tokenize(content)
    candidates = []
    for row in rows:
        if row.id in created_commitment_ids:
            continue
        title = row.canonical_title or ""
        description = row.canonical_description or ""
        tokens = _tokenize(title) | _tokenize(description)
        score = _similarity(tokens, content_tokens)
        if score < 0.1:
            continue
        candidates.append(
            {
                "id": row.id,
                "title": title,
                "description": description,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "status": row.commitment_status,
                "score": score,
            }
        )

    if not candidates:
        return {}

    # Limit to top 20 similar commitments
    candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)[:20]

    llm = get_llm_service()
    llm_calls: list[LLMCall] = []

    try:
        messages = get_commitment_fulfillment_prompt(
            content=content,
            commitments=candidates,
            source_type=state.input.source_type,
        )

        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=CommitmentFulfillmentOutput,
            model_tier="fast",
            node_name="auto_close_commitments",
        )
        llm_calls.append(LLMCall(
            node="auto_close_commitments",
            model=llm_call.model,
            prompt_tokens=llm_call.prompt_tokens,
            completion_tokens=llm_call.completion_tokens,
            duration_ms=llm_call.duration_ms,
        ))

        fulfilled = output.fulfilled if output else []
        if not fulfilled:
            return {
                "trace": {
                    **state.trace.model_dump(),
                    "node_timings": {
                        **state.trace.node_timings,
                        "auto_close_commitments": NodeTiming(
                            started_at=start_time,
                            completed_at=time.time(),
                        ),
                    },
                    "llm_calls": state.trace.llm_calls + llm_calls,
                },
            }

        now = datetime.now(timezone.utc)
        message_id = (state.input.message_ids or [None])[0]

        async with get_db_session() as session:
            for item in fulfilled:
                match = next((c for c in candidates if c["id"] == item.commitment_id), None)
                if not match:
                    continue
                quote = (item.evidence_quote or "").strip()
                if not quote:
                    continue
                start, end = find_quote_span(content, quote)
                if start is None:
                    continue

                await session.execute(
                    text(
                        """
                        UPDATE unified_intelligence_object
                        SET status = 'completed',
                            last_updated_at = :now,
                            updated_at = :now
                        WHERE id = :uio_id
                          AND organization_id = :org_id
                        """
                    ),
                    {"now": now, "uio_id": match["id"], "org_id": org_id},
                )
                await session.execute(
                    text(
                        """
                        UPDATE uio_commitment_details
                        SET status = 'completed',
                            completed_at = :now,
                            completed_via = 'auto'
                        WHERE uio_id = :uio_id
                        """
                    ),
                    {"now": now, "uio_id": match["id"]},
                )
                await session.execute(
                    text(
                        """
                        INSERT INTO unified_object_timeline (
                            id, unified_object_id,
                            event_type, event_description,
                            previous_value, new_value,
                            source_type, source_id, source_name,
                            message_id, quoted_text,
                            triggered_by, confidence, event_at
                        ) VALUES (
                            :id, :uio_id,
                            :event_type, :event_description,
                            :previous_value, :new_value,
                            :source_type, :source_id, :source_name,
                            :message_id, :quoted_text,
                            :triggered_by, :confidence, :event_at
                        )
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "uio_id": match["id"],
                        "event_type": "commitment_fulfilled",
                        "event_description": "Commitment fulfilled based on new evidence",
                        "previous_value": json.dumps({"status": match["status"]}),
                        "new_value": json.dumps({"status": "completed"}),
                        "source_type": state.input.source_type,
                        "source_id": state.input.source_id,
                        "source_name": None,
                        "message_id": message_id,
                        "quoted_text": quote,
                        "triggered_by": "auto",
                        "confidence": item.confidence,
                        "event_at": now,
                    },
                )
            await session.commit()

        try:
            from src.graph.client import get_graph_client
            graph = await get_graph_client()
            for item in fulfilled:
                match = next((c for c in candidates if c["id"] == item.commitment_id), None)
                if not match:
                    continue
                await graph.query(
                    """
                    MATCH (c:Commitment {id: $id, organizationId: $orgId})
                    SET c.status = 'completed',
                        c.completedAt = $now,
                        c.completedVia = 'auto',
                        c.fulfillmentEvidence = $evidence
                    """,
                    {
                        "id": match["id"],
                        "orgId": org_id,
                        "now": now.isoformat(),
                        "evidence": item.evidence_quote,
                    },
                )
        except Exception as exc:
            logger.warning("Failed to sync commitment completion to graph", error=str(exc))

        return {
            "trace": {
                **state.trace.model_dump(),
                "node_timings": {
                    **state.trace.node_timings,
                    "auto_close_commitments": NodeTiming(
                        started_at=start_time,
                        completed_at=time.time(),
                    ),
                },
                "llm_calls": state.trace.llm_calls + llm_calls,
            },
        }

    except Exception as exc:
        logger.error("Auto close commitments failed", error=str(exc))
        return {
            "trace": {
                **state.trace.model_dump(),
                "node_timings": {
                    **state.trace.node_timings,
                    "auto_close_commitments": NodeTiming(
                        started_at=start_time,
                        completed_at=time.time(),
                    ),
                },
                "errors": state.trace.errors + [f"auto_close_commitments: {str(exc)}"],
            }
        }
