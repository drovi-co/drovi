"""Derived indexes builder for UIO truth batches.

This module rebuilds graph-derived indexes from canonical Postgres truth.
It is invoked from the outbox drain job.

Phase 6 improvements to land here:
- batch graph upserts per label
- batch embedding generation
- idempotent relationship upserts for supersession/contradictions
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

import structlog

from src.config import get_settings
from src.db.client import get_db_pool
from src.db.rls import rls_context
from src.kernel.time import utc_now
from src.search.embeddings import EmbeddingError, generate_embeddings_batch

logger = structlog.get_logger()


_UIO_TYPE_TO_LABEL: dict[str, str] = {
    "commitment": "Commitment",
    "decision": "Decision",
    "task": "Task",
    "risk": "Risk",
    "claim": "Claim",
    "brief": "Brief",
}


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return None


def _episode_id(*, organization_id: str, analysis_id: str) -> str:
    material = f"episode:{organization_id}:{analysis_id}"
    return "ep_" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


def _embedding_text_hash(text: str, *, model: str) -> str:
    material = f"{model}:{text}".encode("utf-8", errors="ignore")
    return hashlib.sha256(material).hexdigest()


async def _fetch_uio_base_rows(
    *,
    organization_id: str,
    uio_ids: list[str],
) -> list[dict[str, Any]]:
    if not uio_ids:
        return []

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    type,
                    status,
                    canonical_title,
                    canonical_description,
                    overall_confidence,
                    due_date,
                    valid_from,
                    valid_to,
                    system_from,
                    system_to,
                    created_at,
                    updated_at
                FROM unified_intelligence_object
                WHERE organization_id = $1
                  AND id = ANY($2::text[])
                """,
                organization_id,
                uio_ids,
            )
    return [dict(r) for r in (rows or [])]


async def _fetch_details_by_type(
    *,
    organization_id: str,
    uios_by_type: dict[str, list[str]],
) -> dict[str, dict[str, Any]]:
    """
    Fetch type-specific detail rows for UIOs.

    Returns:
      map uio_id -> details dict (may include supersession fields)
    """
    if not uios_by_type:
        return {}

    out: dict[str, dict[str, Any]] = {}

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Commitments
            commitment_ids = uios_by_type.get("commitment") or []
            if commitment_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        direction,
                        priority,
                        status,
                        debtor_contact_id,
                        creditor_contact_id,
                        supersedes_uio_id,
                        superseded_by_uio_id
                    FROM uio_commitment_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    commitment_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

            # Decisions
            decision_ids = uios_by_type.get("decision") or []
            if decision_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        statement,
                        rationale,
                        status,
                        decision_maker_contact_id,
                        decided_at,
                        supersedes_uio_id,
                        superseded_by_uio_id
                    FROM uio_decision_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    decision_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

            # Tasks
            task_ids = uios_by_type.get("task") or []
            if task_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        status,
                        priority,
                        assignee_contact_id,
                        project,
                        tags,
                        supersedes_uio_id,
                        superseded_by_uio_id
                    FROM uio_task_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    task_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

            # Risks
            risk_ids = uios_by_type.get("risk") or []
            if risk_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        risk_type,
                        severity,
                        suggested_action,
                        supersedes_uio_id,
                        superseded_by_uio_id
                    FROM uio_risk_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    risk_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

            # Claims
            claim_ids = uios_by_type.get("claim") or []
            if claim_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        claim_type,
                        importance,
                        normalized_text
                    FROM uio_claim_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    claim_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

            # Briefs
            brief_ids = uios_by_type.get("brief") or []
            if brief_ids:
                rows = await conn.fetch(
                    """
                    SELECT
                        uio_id::text,
                        summary,
                        suggested_action,
                        priority_tier,
                        urgency_score,
                        importance_score,
                        sentiment_score,
                        intent_classification,
                        conversation_id
                    FROM uio_brief_details
                    WHERE uio_id = ANY($1::text[])
                    """,
                    brief_ids,
                )
                for r in rows or []:
                    d = dict(r)
                    out[str(d["uio_id"])] = d

    return out


async def _fetch_contradictions(
    *,
    organization_id: str,
    uio_ids: list[str],
) -> list[dict[str, Any]]:
    if not uio_ids:
        return []

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    uio_a_id::text AS uio_a_id,
                    uio_b_id::text AS uio_b_id,
                    contradiction_type,
                    severity,
                    evidence_quote,
                    detected_at
                FROM uio_contradiction
                WHERE organization_id = $1
                  AND (uio_a_id = ANY($2::text[]) OR uio_b_id = ANY($2::text[]))
                """,
                organization_id,
                uio_ids,
            )
    return [dict(r) for r in (rows or [])]


async def _upsert_contact_nodes(
    *,
    graph: Any,
    organization_id: str,
    sender_email: str | None,
    contact_ids: list[str],
) -> None:
    """
    Upsert Contact nodes needed for relationship updates.

    We MERGE by (organizationId, email) to align with graph constraints.
    """
    now_iso = utc_now().isoformat()

    rows: list[dict[str, Any]] = []

    if contact_ids:
        with rls_context(organization_id, is_internal=True):
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                db_rows = await conn.fetch(
                    """
                    SELECT id::text, primary_email, display_name
                    FROM contact
                    WHERE organization_id = $1 AND id = ANY($2::text[])
                    """,
                    organization_id,
                    contact_ids,
                )
        for r in db_rows or []:
            d = dict(r)
            email = str(d.get("primary_email") or "")
            if not email:
                continue
            rows.append(
                {
                    "id": str(d.get("id") or ""),
                    "email": email,
                    "name": d.get("display_name"),
                }
            )

    if sender_email:
        rows.append({"id": "", "email": sender_email, "name": None})

    # Dedupe by email.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        email = str(r.get("email") or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        deduped.append({**r, "email": email})

    if not deduped:
        return

    await graph.query(
        """
        UNWIND $rows AS row
        MERGE (c:Contact {organizationId: $orgId, email: row.email})
        ON CREATE SET c.createdAt = $now
        SET c.updatedAt = $now,
            c.id = CASE WHEN row.id IS NULL OR row.id = '' THEN c.id ELSE row.id END,
            c.name = CASE WHEN row.name IS NULL OR row.name = '' THEN c.name ELSE row.name END
        """,
        {"rows": deduped, "orgId": organization_id, "now": now_iso},
    )


async def _update_communications_edges(
    *,
    graph: Any,
    organization_id: str,
    sender_email: str | None,
    contact_emails: list[str],
) -> None:
    if not sender_email:
        return
    receivers = [e for e in contact_emails if e and e != sender_email]
    if not receivers:
        return

    now_iso = utc_now().isoformat()
    await graph.query(
        """
        UNWIND $receivers AS receiverEmail
        MATCH (sender:Contact {organizationId: $orgId, email: $senderEmail})
        MATCH (receiver:Contact {organizationId: $orgId, email: receiverEmail})
        MERGE (sender)-[r:COMMUNICATES_WITH]->(receiver)
        ON CREATE SET r.firstContact = $now,
                      r.lastContact = $now,
                      r.messageCount = 1,
                      r.createdAt = $now,
                      r.updatedAt = $now,
                      r.validFrom = $now,
                      r.validTo = NULL,
                      r.systemFrom = $now,
                      r.systemTo = NULL
        ON MATCH SET r.lastContact = $now,
                     r.messageCount = r.messageCount + 1,
                     r.updatedAt = $now
        """,
        {
            "orgId": organization_id,
            "senderEmail": sender_email,
            "receivers": receivers,
            "now": now_iso,
        },
    )


async def _upsert_uio_nodes_batched(
    *,
    graph: Any,
    organization_id: str,
    uio_rows: list[dict[str, Any]],
    details_by_uio_id: dict[str, dict[str, Any]],
) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Upsert UIO nodes (by label) and return:
    - all_uio_ids indexed
    - supersession_pairs (new_id, old_id)
    - embed_requests (id, text, hash)
    """
    if not uio_rows:
        return [], [], []

    now = utc_now()
    now_iso = now.isoformat()

    # Build graph rows per label and embed requests.
    rows_by_label: dict[str, list[dict[str, Any]]] = {}
    supersession_pairs: list[dict[str, Any]] = []
    embed_requests: list[dict[str, Any]] = []

    settings = get_settings()
    embed_model = str(settings.embedding_model or "unknown")

    for row in uio_rows:
        uio_id = str(row.get("id") or "")
        uio_type = str(row.get("type") or "")
        label = _UIO_TYPE_TO_LABEL.get(uio_type)
        if not uio_id or not label:
            continue

        details = details_by_uio_id.get(uio_id) or {}

        title = str(row.get("canonical_title") or "")
        description = str(row.get("canonical_description") or "")
        confidence = float(row.get("overall_confidence") or 0.0)
        uio_status = str(row.get("status") or "active")

        created_at = row.get("created_at")
        updated_at = row.get("updated_at") or created_at or now

        due_date = row.get("due_date")

        # Type-specific "status" is more useful than unified_intelligence_object.status.
        status = details.get("status") or uio_status

        graph_row: dict[str, Any] = {
            "id": uio_id,
            "type": uio_type,
            "title": title,
            "description": description,
            "uioStatus": uio_status,
            "status": status,
            "confidence": confidence,
            "dueDate": _iso(due_date),
            "createdAt": _iso(created_at) or _iso(updated_at) or now_iso,
            "updatedAt": _iso(updated_at) or now_iso,
            "validFrom": _iso(row.get("valid_from")) or _iso(created_at) or now_iso,
            "validTo": _iso(row.get("valid_to")),
            "systemFrom": _iso(row.get("system_from")) or _iso(created_at) or now_iso,
            "systemTo": _iso(row.get("system_to")),
        }

        # Enrich with details per type.
        if uio_type == "commitment":
            graph_row.update(
                {
                    "direction": details.get("direction"),
                    "priority": details.get("priority"),
                    "debtorContactId": details.get("debtor_contact_id"),
                    "creditorContactId": details.get("creditor_contact_id"),
                }
            )
        elif uio_type == "decision":
            graph_row.update(
                {
                    "statement": details.get("statement"),
                    "rationale": details.get("rationale"),
                    "decisionMakerContactId": details.get("decision_maker_contact_id"),
                    "decidedAt": _iso(details.get("decided_at")),
                }
            )
        elif uio_type == "task":
            graph_row.update(
                {
                    "priority": details.get("priority"),
                    "assigneeContactId": details.get("assignee_contact_id"),
                    "project": details.get("project"),
                    "tags": list(details.get("tags") or []),
                }
            )
        elif uio_type == "risk":
            graph_row.update(
                {
                    "riskType": details.get("risk_type"),
                    "severity": details.get("severity"),
                    "suggestedAction": details.get("suggested_action"),
                }
            )
        elif uio_type == "claim":
            graph_row.update(
                {
                    "claimType": details.get("claim_type"),
                    "importance": details.get("importance"),
                    "normalizedText": details.get("normalized_text"),
                }
            )
        elif uio_type == "brief":
            graph_row.update(
                {
                    "summary": details.get("summary"),
                    "suggestedAction": details.get("suggested_action"),
                    "priorityTier": details.get("priority_tier"),
                    "urgencyScore": float(details.get("urgency_score") or 0.0),
                    "importanceScore": float(details.get("importance_score") or 0.0),
                    "sentimentScore": float(details.get("sentiment_score") or 0.0),
                    "intentClassification": details.get("intent_classification"),
                    "conversationId": details.get("conversation_id"),
                }
            )

        # Supersession pairs: new supersedes old.
        supersedes = details.get("supersedes_uio_id")
        if supersedes:
            supersession_pairs.append(
                {
                    "newId": uio_id,
                    "oldId": str(supersedes),
                    "reason": "updated",
                    "at": now_iso,
                }
            )
        superseded_by = details.get("superseded_by_uio_id")
        if superseded_by:
            supersession_pairs.append(
                {
                    "newId": str(superseded_by),
                    "oldId": uio_id,
                    "reason": "updated",
                    "at": now_iso,
                }
            )

        rows_by_label.setdefault(label, []).append(graph_row)

        # Embedding request (best-effort).
        embed_parts: list[str] = [title, description]
        if uio_type == "decision":
            embed_parts.extend([str(details.get("statement") or ""), str(details.get("rationale") or "")])
        if uio_type == "risk":
            embed_parts.extend([str(details.get("risk_type") or ""), str(details.get("severity") or "")])
        if uio_type == "task":
            embed_parts.extend([str(details.get("project") or ""), " ".join(list(details.get("tags") or []))])
        if uio_type == "brief":
            embed_parts.extend([str(details.get("summary") or ""), str(details.get("suggested_action") or "")])
        text = " ".join([p.strip() for p in embed_parts if p and str(p).strip()]).strip()
        if text:
            text_for_embedding = text[:8000]
            embed_requests.append(
                {
                    "id": uio_id,
                    "text": text_for_embedding,
                    "hash": _embedding_text_hash(text_for_embedding, model=embed_model),
                }
            )

    # Batched upserts per label.
    for label, rows in rows_by_label.items():
        if not rows:
            continue
        # Attach the UIO label for cross-type queries.
        await graph.query(
            f"""
            UNWIND $rows AS row
            MERGE (n:UIO:{label} {{id: row.id, organizationId: $orgId}})
            ON CREATE SET n.createdAt = row.createdAt
            SET n.updatedAt = row.updatedAt,
                n.type = row.type,
                n.title = row.title,
                n.description = row.description,
                n.uioStatus = row.uioStatus,
                n.status = row.status,
                n.confidence = row.confidence,
                n.dueDate = row.dueDate,
                n.validFrom = row.validFrom,
                n.validTo = row.validTo,
                n.systemFrom = row.systemFrom,
                n.systemTo = row.systemTo,
                n.direction = row.direction,
                n.priority = row.priority,
                n.debtorContactId = row.debtorContactId,
                n.creditorContactId = row.creditorContactId,
                n.statement = row.statement,
                n.rationale = row.rationale,
                n.decisionMakerContactId = row.decisionMakerContactId,
                n.decidedAt = row.decidedAt,
                n.assigneeContactId = row.assigneeContactId,
                n.project = row.project,
                n.tags = row.tags,
                n.riskType = row.riskType,
                n.severity = row.severity,
                n.suggestedAction = row.suggestedAction,
                n.claimType = row.claimType,
                n.importance = row.importance,
                n.normalizedText = row.normalizedText,
                n.summary = row.summary,
                n.priorityTier = row.priorityTier,
                n.urgencyScore = row.urgencyScore,
                n.importanceScore = row.importanceScore,
                n.sentimentScore = row.sentimentScore,
                n.intentClassification = row.intentClassification,
                n.conversationId = row.conversationId
            """,
            {"rows": rows, "orgId": organization_id},
        )

    return [str(r.get("id")) for r in uio_rows if r.get("id")], supersession_pairs, embed_requests


async def _set_embeddings_batched(
    *,
    graph: Any,
    organization_id: str,
    embed_requests: list[dict[str, Any]],
) -> int:
    if not embed_requests:
        return 0

    # Query existing hashes to skip unchanged embeddings.
    try:
        existing = await graph.query(
            """
            UNWIND $ids AS id
            MATCH (n {id: id, organizationId: $orgId})
            RETURN n.id AS id, n.embeddingTextHash AS embeddingTextHash
            """,
            {"ids": [str(r["id"]) for r in embed_requests], "orgId": organization_id},
        )
        existing_by_id: dict[str, str] = {
            str(row.get("id")): str(row.get("embeddingTextHash") or "")
            for row in (existing or [])
            if row.get("id")
        }
    except Exception:
        existing_by_id = {}

    to_embed: list[dict[str, Any]] = []
    for r in embed_requests:
        if existing_by_id.get(str(r["id"])) == str(r["hash"]):
            continue
        to_embed.append(r)

    if not to_embed:
        return 0

    embedded = 0
    batch_size = 64
    for start in range(0, len(to_embed), batch_size):
        batch = to_embed[start : start + batch_size]
        texts = [str(r["text"]) for r in batch]
        try:
            embeddings = await generate_embeddings_batch(texts)
        except (EmbeddingError, Exception) as exc:
            logger.warning("Embedding batch failed (UIO)", error=str(exc), count=len(texts))
            break

        rows = []
        for req, emb in zip(batch, embeddings):
            rows.append({"id": req["id"], "embedding": emb, "hash": req["hash"]})

        try:
            await graph.query(
                """
                UNWIND $rows AS row
                MATCH (n {id: row.id, organizationId: $orgId})
                SET n.embedding = vecf32(row.embedding),
                    n.embeddingTextHash = row.hash
                """,
                {"rows": rows, "orgId": organization_id},
            )
            embedded += len(rows)
        except Exception as exc:
            logger.warning("Failed to set embeddings in graph (UIO)", error=str(exc), count=len(rows))
            break

    return embedded


async def _upsert_episode_and_links(
    *,
    graph: Any,
    organization_id: str,
    analysis_id: str,
    source_type: str | None,
    source_id: str | None,
    extracted_uio_ids: list[str],
) -> str:
    episode_id = _episode_id(organization_id=organization_id, analysis_id=analysis_id)
    iso_now = utc_now().isoformat()

    await graph.query(
        """
        MERGE (e:Episode {id: $id})
        ON CREATE SET e.organizationId = $orgId,
                      e.analysisId = $analysisId,
                      e.sourceType = $sourceType,
                      e.sourceId = $sourceId,
                      e.createdAt = $createdAt,
                      e.validFrom = $validFrom,
                      e.validTo = $validTo,
                      e.systemFrom = $systemFrom,
                      e.systemTo = $systemTo
        RETURN e
        """,
        {
            "id": episode_id,
            "orgId": organization_id,
            "analysisId": analysis_id,
            "sourceType": source_type,
            "sourceId": source_id,
            "createdAt": iso_now,
            "validFrom": iso_now,
            "validTo": None,
            "systemFrom": iso_now,
            "systemTo": None,
        },
    )

    if extracted_uio_ids:
        await graph.query(
            """
            UNWIND $uioIds AS uioId
            MATCH (e:Episode {id: $episodeId})
            MATCH (u {id: uioId, organizationId: $orgId})
            MERGE (e)-[r:EXTRACTED]->(u)
            ON CREATE SET r.createdAt = $now,
                          r.updatedAt = $now,
                          r.validFrom = $now,
                          r.validTo = NULL,
                          r.systemFrom = $now,
                          r.systemTo = NULL
            ON MATCH SET r.updatedAt = $now
            """,
            {
                "episodeId": episode_id,
                "uioIds": extracted_uio_ids,
                "orgId": organization_id,
                "now": iso_now,
            },
        )

    return episode_id


async def _upsert_supersession_edges(
    *,
    graph: Any,
    organization_id: str,
    pairs: list[dict[str, Any]],
) -> int:
    if not pairs:
        return 0

    # Dedupe pairs.
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for p in pairs:
        old_id = str(p.get("oldId") or "")
        new_id = str(p.get("newId") or "")
        if not old_id or not new_id:
            continue
        key = (old_id, new_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append({"oldId": old_id, "newId": new_id, "reason": p.get("reason") or "updated", "at": p.get("at")})

    if not deduped:
        return 0

    await graph.query(
        """
        UNWIND $pairs AS row
        MATCH (old {id: row.oldId, organizationId: $orgId})
        MATCH (new {id: row.newId, organizationId: $orgId})
        MERGE (new)-[r:SUPERSEDES]->(old)
        ON CREATE SET r.supersededAt = row.at,
                      r.reason = row.reason
        ON MATCH SET r.supersededAt = COALESCE(r.supersededAt, row.at),
                     r.reason = COALESCE(r.reason, row.reason)
        SET old.supersededById = row.newId,
            old.supersessionReason = row.reason
        """,
        {"pairs": deduped, "orgId": organization_id},
    )
    return len(deduped)


async def _upsert_contradiction_edges(
    *,
    graph: Any,
    organization_id: str,
    contradictions: list[dict[str, Any]],
) -> int:
    if not contradictions:
        return 0

    rows: list[dict[str, Any]] = []
    for c in contradictions:
        a_id = str(c.get("uio_a_id") or "")
        b_id = str(c.get("uio_b_id") or "")
        if not a_id or not b_id:
            continue
        rows.append(
            {
                "aId": a_id,
                "bId": b_id,
                "type": c.get("contradiction_type"),
                "severity": c.get("severity") or "medium",
                "evidence": c.get("evidence_quote"),
                "detectedAt": _iso(c.get("detected_at")) or utc_now().isoformat(),
            }
        )

    if not rows:
        return 0

    await graph.query(
        """
        UNWIND $rows AS row
        MATCH (a {id: row.aId, organizationId: $orgId})
        MATCH (b {id: row.bId, organizationId: $orgId})
        MERGE (a)-[r:CONTRADICTS]->(b)
        ON CREATE SET r.detectedAt = row.detectedAt
        SET r.contradictionType = row.type,
            r.severity = row.severity,
            r.evidence = row.evidence
        """,
        {"rows": rows, "orgId": organization_id},
    )
    return len(rows)


async def process_indexes_derived_batch_event(*, graph: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Process an `indexes.derived.batch` outbox payload.

    Returns a small stats dict for observability.
    """
    organization_id = str(payload.get("organization_id") or payload.get("org_id") or payload.get("orgId") or "")
    analysis_id = str(payload.get("analysis_id") or payload.get("analysisId") or "")
    if not organization_id or not analysis_id:
        raise ValueError("indexes.derived.batch payload missing organization_id/analysis_id")

    # 1) Determine UIOs affected by this batch.
    uios_created = payload.get("uios_created") or []
    created_uio_ids = [
        str(u.get("id"))
        for u in uios_created
        if isinstance(u, dict) and u.get("id")
    ]
    uios_merged = payload.get("uios_merged") or []
    merged_target_ids = [
        str(u.get("targetId") or u.get("target_id") or "")
        for u in uios_merged
        if isinstance(u, dict) and (u.get("targetId") or u.get("target_id"))
    ]
    uio_ids = sorted({*created_uio_ids, *merged_target_ids})

    # 2) Upsert Contact nodes needed for COMMUNICATES_WITH updates.
    sender_email = payload.get("sender_email")
    contacts_created = payload.get("contacts_created") or payload.get("contacts") or []
    contact_ids = [
        str(c.get("id"))
        for c in contacts_created
        if isinstance(c, dict) and c.get("id")
    ]
    contact_emails = [
        str(c.get("email") or "").strip().lower()
        for c in contacts_created
        if isinstance(c, dict) and c.get("email")
    ]

    try:
        await _upsert_contact_nodes(
            graph=graph,
            organization_id=organization_id,
            sender_email=str(sender_email).strip().lower() if sender_email else None,
            contact_ids=contact_ids,
        )
    except Exception as exc:
        logger.warning("Failed to upsert Contact nodes", error=str(exc), organization_id=organization_id)

    try:
        await _update_communications_edges(
            graph=graph,
            organization_id=organization_id,
            sender_email=str(sender_email).strip().lower() if sender_email else None,
            contact_emails=contact_emails,
        )
    except Exception as exc:
        logger.warning("Failed to update COMMUNICATES_WITH edges", error=str(exc), organization_id=organization_id)

    # 3) Fetch canonical truth from Postgres (base + details).
    base_rows = await _fetch_uio_base_rows(organization_id=organization_id, uio_ids=uio_ids)
    by_id: dict[str, dict[str, Any]] = {str(r.get("id")): r for r in base_rows if r.get("id")}

    uios_by_type: dict[str, list[str]] = {}
    for r in base_rows:
        uid = str(r.get("id") or "")
        t = str(r.get("type") or "")
        if uid and t:
            uios_by_type.setdefault(t, []).append(uid)

    details_by_id = await _fetch_details_by_type(organization_id=organization_id, uios_by_type=uios_by_type)

    # Collect supersession-linked IDs so we also refresh the "old" nodes' validTo/systemTo.
    extra_ids: set[str] = set()
    for d in details_by_id.values():
        if d.get("supersedes_uio_id"):
            extra_ids.add(str(d.get("supersedes_uio_id")))
        if d.get("superseded_by_uio_id"):
            extra_ids.add(str(d.get("superseded_by_uio_id")))

    if extra_ids:
        missing = sorted([i for i in extra_ids if i and i not in by_id])
        if missing:
            extra_rows = await _fetch_uio_base_rows(organization_id=organization_id, uio_ids=missing)
            for r in extra_rows:
                if r.get("id"):
                    by_id[str(r["id"])] = r
            for r in extra_rows:
                uid = str(r.get("id") or "")
                t = str(r.get("type") or "")
                if uid and t:
                    uios_by_type.setdefault(t, []).append(uid)

            # Fetch details for the extra IDs too (so we can set type-specific fields).
            details_extra = await _fetch_details_by_type(
                organization_id=organization_id,
                uios_by_type={k: [i for i in v if i in missing] for k, v in uios_by_type.items()},
            )
            details_by_id.update(details_extra)

    all_uio_rows = list(by_id.values())

    # 4) Upsert nodes + derived edges.
    all_ids, supersession_pairs, embed_requests = await _upsert_uio_nodes_batched(
        graph=graph,
        organization_id=organization_id,
        uio_rows=all_uio_rows,
        details_by_uio_id=details_by_id,
    )

    episode_id = await _upsert_episode_and_links(
        graph=graph,
        organization_id=organization_id,
        analysis_id=analysis_id,
        source_type=payload.get("source_type"),
        source_id=payload.get("source_id"),
        extracted_uio_ids=created_uio_ids,
    )

    supersession_edge_count = 0
    try:
        supersession_edge_count = await _upsert_supersession_edges(
            graph=graph,
            organization_id=organization_id,
            pairs=supersession_pairs,
        )
    except Exception as exc:
        logger.warning("Failed to upsert supersession edges", error=str(exc))

    contradiction_edge_count = 0
    try:
        contradictions = await _fetch_contradictions(organization_id=organization_id, uio_ids=all_ids)
        contradiction_edge_count = await _upsert_contradiction_edges(
            graph=graph,
            organization_id=organization_id,
            contradictions=contradictions,
        )
    except Exception as exc:
        logger.warning("Failed to upsert contradiction edges", error=str(exc))

    embedded_count = 0
    try:
        embedded_count = await _set_embeddings_batched(
            graph=graph,
            organization_id=organization_id,
            embed_requests=embed_requests,
        )
    except Exception as exc:
        logger.warning("Failed to set UIO embeddings", error=str(exc))

    return {
        "organization_id": organization_id,
        "analysis_id": analysis_id,
        "episode_id": episode_id,
        "uio_count": len(all_ids),
        "uio_embedded": int(embedded_count),
        "supersession_edges": int(supersession_edge_count),
        "contradiction_edges": int(contradiction_edge_count),
    }
