"""Derived index processing for evidence artifacts.

This processor projects canonical evidence artifacts from Postgres into graph
indexes so cross-surface navigation (documents, contradictions, UIOs) can follow
artifact links without joining relational tables at query time.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from src.db.client import get_db_pool
from src.db.rls import rls_context
from src.kernel.time import utc_now


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None


async def process_indexes_evidence_artifact_registered_event(
    *,
    graph: Any,
    payload: dict[str, Any],
) -> dict[str, Any]:
    organization_id = str(payload.get("organization_id") or payload.get("org_id") or payload.get("orgId") or "")
    artifact_id = str(payload.get("artifact_id") or "")
    if not organization_id or not artifact_id:
        raise ValueError("indexes.evidence.artifact.registered payload missing organization_id/artifact_id")

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            artifact_row = await conn.fetchrow(
                """
                SELECT
                    id::text AS id,
                    organization_id,
                    session_id,
                    source_type,
                    source_id,
                    artifact_type,
                    mime_type,
                    storage_backend,
                    storage_path,
                    byte_size,
                    sha256,
                    metadata,
                    created_at,
                    retention_until,
                    immutable,
                    legal_hold,
                    deleted_at
                FROM evidence_artifact
                WHERE organization_id = $1 AND id = $2
                """,
                organization_id,
                artifact_id,
            )

            # Artifacts may be hard-deleted or retention-deleted before the outbox
            # event is drained. Remove stale graph projection and succeed.
            if not artifact_row or artifact_row.get("deleted_at") is not None:
                await graph.query(
                    """
                    MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
                    DETACH DELETE e
                    """,
                    {"artifactId": artifact_id, "orgId": organization_id},
                )
                return {
                    "organization_id": organization_id,
                    "artifact_id": artifact_id,
                    "deleted": True,
                    "ok": True,
                }

            artifact = dict(artifact_row)

            document_rows = await conn.fetch(
                """
                SELECT id::text AS id
                FROM document
                WHERE organization_id = $1
                  AND evidence_artifact_id = $2
                """,
                organization_id,
                artifact_id,
            )
            chunk_rows = await conn.fetch(
                """
                SELECT id::text AS id, document_id::text AS document_id
                FROM document_chunk
                WHERE organization_id = $1
                  AND image_artifact_id = $2
                """,
                organization_id,
                artifact_id,
            )
            contradiction_rows = await conn.fetch(
                """
                SELECT id::text AS id, uio_a_id::text AS uio_a_id, uio_b_id::text AS uio_b_id
                FROM uio_contradiction
                WHERE organization_id = $1
                  AND evidence_artifact_id = $2
                """,
                organization_id,
                artifact_id,
            )
            linked_event_count = int(
                await conn.fetchval(
                    """
                    SELECT COUNT(*)::bigint
                    FROM unified_event
                    WHERE organization_id = $1
                      AND evidence_artifact_id = $2
                    """,
                    organization_id,
                    artifact_id,
                )
                or 0
            )

    document_ids = {str(row["id"]) for row in (document_rows or []) if row.get("id")}
    chunk_ids = {str(row["id"]) for row in (chunk_rows or []) if row.get("id")}
    document_ids.update(
        str(row["document_id"])
        for row in (chunk_rows or [])
        if row.get("document_id")
    )
    contradiction_ids = {str(row["id"]) for row in (contradiction_rows or []) if row.get("id")}
    uio_ids: set[str] = set()
    for row in contradiction_rows or []:
        if row.get("uio_a_id"):
            uio_ids.add(str(row["uio_a_id"]))
        if row.get("uio_b_id"):
            uio_ids.add(str(row["uio_b_id"]))

    now_iso = utc_now().isoformat()
    await graph.query(
        """
        MERGE (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
        ON CREATE SET e.createdAt = $createdAt
        SET e.updatedAt = $updatedAt,
            e.sessionId = $sessionId,
            e.sourceType = $sourceType,
            e.sourceId = $sourceId,
            e.artifactType = $artifactType,
            e.mimeType = $mimeType,
            e.storageBackend = $storageBackend,
            e.storagePath = $storagePath,
            e.byteSize = $byteSize,
            e.sha256 = $sha256,
            e.metadataJson = $metadataJson,
            e.retentionUntil = $retentionUntil,
            e.immutable = $immutable,
            e.legalHold = $legalHold,
            e.linkedEventCount = $linkedEventCount,
            e.linkedDocumentCount = $linkedDocumentCount,
            e.linkedChunkCount = $linkedChunkCount,
            e.linkedContradictionCount = $linkedContradictionCount,
            e.linkedUIOCount = $linkedUIOCount
        """,
        {
            "artifactId": artifact_id,
            "orgId": organization_id,
            "createdAt": _iso(artifact.get("created_at")) or now_iso,
            "updatedAt": now_iso,
            "sessionId": artifact.get("session_id"),
            "sourceType": artifact.get("source_type"),
            "sourceId": artifact.get("source_id"),
            "artifactType": artifact.get("artifact_type"),
            "mimeType": artifact.get("mime_type"),
            "storageBackend": artifact.get("storage_backend"),
            "storagePath": artifact.get("storage_path"),
            "byteSize": int(artifact.get("byte_size")) if artifact.get("byte_size") is not None else None,
            "sha256": artifact.get("sha256"),
            "metadataJson": json.dumps(artifact.get("metadata") or {}, sort_keys=True),
            "retentionUntil": _iso(artifact.get("retention_until")),
            "immutable": bool(artifact.get("immutable")) if artifact.get("immutable") is not None else None,
            "legalHold": bool(artifact.get("legal_hold")) if artifact.get("legal_hold") is not None else None,
            "linkedEventCount": linked_event_count,
            "linkedDocumentCount": len(document_ids),
            "linkedChunkCount": len(chunk_ids),
            "linkedContradictionCount": len(contradiction_ids),
            "linkedUIOCount": len(uio_ids),
        },
    )

    # Replace managed relationships in full so projections stay deterministic.
    await graph.query(
        """
        MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})-[r:RELATED_TO]->(n)
        WHERE n:Document OR n:DocumentChunk OR n:Contradiction OR n:UIO
        DELETE r
        """,
        {"artifactId": artifact_id, "orgId": organization_id},
    )

    if chunk_ids:
        await graph.query(
            """
            UNWIND $chunkIds AS chunkId
            MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
            MATCH (c:DocumentChunk {id: chunkId, organizationId: $orgId})
            MERGE (e)-[:RELATED_TO]->(c)
            """,
            {"artifactId": artifact_id, "orgId": organization_id, "chunkIds": list(chunk_ids)},
        )

    if document_ids:
        await graph.query(
            """
            UNWIND $documentIds AS documentId
            MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
            MATCH (d:Document {id: documentId, organizationId: $orgId})
            MERGE (e)-[:RELATED_TO]->(d)
            """,
            {"artifactId": artifact_id, "orgId": organization_id, "documentIds": list(document_ids)},
        )

    if contradiction_ids:
        await graph.query(
            """
            UNWIND $contradictionIds AS contradictionId
            MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
            MATCH (c:Contradiction {id: contradictionId, organizationId: $orgId})
            MERGE (e)-[:RELATED_TO]->(c)
            """,
            {"artifactId": artifact_id, "orgId": organization_id, "contradictionIds": list(contradiction_ids)},
        )

    if uio_ids:
        await graph.query(
            """
            UNWIND $uioIds AS uioId
            MATCH (e:EvidenceArtifact {id: $artifactId, organizationId: $orgId})
            MATCH (u:UIO {id: uioId, organizationId: $orgId})
            MERGE (e)-[:RELATED_TO]->(u)
            """,
            {"artifactId": artifact_id, "orgId": organization_id, "uioIds": list(uio_ids)},
        )

    return {
        "organization_id": organization_id,
        "artifact_id": artifact_id,
        "linked_documents": len(document_ids),
        "linked_chunks": len(chunk_ids),
        "linked_contradictions": len(contradiction_ids),
        "linked_uios": len(uio_ids),
        "linked_events": linked_event_count,
        "ok": True,
    }
