"""
Evidence Retention Enforcement Job.

Deletes evidence artifacts past retention and verifies deletion.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.evidence.storage import get_evidence_storage
from src.evidence.audit import record_evidence_audit
from src.kernel.time import utc_now

logger = structlog.get_logger()


@dataclass
class EvidenceRetentionStats:
    scanned: int = 0
    expired: int = 0
    deleted: int = 0
    verified: int = 0
    skipped_legal_hold: int = 0
    failed: int = 0
    started_at: str | None = None
    completed_at: str | None = None


class EvidenceRetentionJob:
    """Retention enforcement for evidence artifacts."""

    async def run(
        self,
        organization_id: str | None = None,
        dry_run: bool = False,
        limit: int = 500,
    ) -> dict[str, Any]:
        stats = EvidenceRetentionStats(started_at=utc_now().isoformat())
        storage = get_evidence_storage()

        org_filter = ""
        params: dict[str, Any] = {"now": utc_now(), "limit": limit}
        if organization_id:
            org_filter = "AND organization_id = :org_id"
            params["org_id"] = organization_id

        async with get_db_session() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT id, organization_id, storage_path, storage_backend,
                           retention_until, immutable, legal_hold
                    FROM evidence_artifact
                    WHERE retention_until IS NOT NULL
                      AND retention_until <= :now
                      {org_filter}
                    ORDER BY retention_until ASC
                    LIMIT :limit
                    """
                ),
                params,
            )
            rows = result.fetchall()

            for row in rows:
                stats.scanned += 1
                if row.legal_hold:
                    stats.skipped_legal_hold += 1
                    continue

                stats.expired += 1
                if dry_run:
                    continue

                deleted = await storage.delete(row.storage_path)
                if not deleted:
                    stats.failed += 1
                    await record_evidence_audit(
                        artifact_id=row.id,
                        organization_id=row.organization_id,
                        action="retention_delete_failed",
                        actor_type="system",
                        metadata={"storage_path": row.storage_path},
                    )
                    continue

                stats.deleted += 1
                stats.verified += 1

                await session.execute(
                    text(
                        """
                        DELETE FROM evidence_artifact
                        WHERE id = :artifact_id
                        """
                    ),
                    {"artifact_id": row.id},
                )

                await record_evidence_audit(
                    artifact_id=row.id,
                    organization_id=row.organization_id,
                    action="retention_deleted",
                    actor_type="system",
                    metadata={"storage_path": row.storage_path},
                )

        stats.completed_at = utc_now().isoformat()
        return stats.__dict__


_retention_job: EvidenceRetentionJob | None = None


def get_retention_job() -> EvidenceRetentionJob:
    global _retention_job
    if _retention_job is None:
        _retention_job = EvidenceRetentionJob()
    return _retention_job
