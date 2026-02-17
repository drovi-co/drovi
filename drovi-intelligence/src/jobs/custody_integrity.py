"""Daily chain-of-custody root generation job."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import json
import structlog
from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.evidence.merkle import merkle_root, sign_merkle_root
from src.kernel.time import utc_now

logger = structlog.get_logger()


@dataclass
class CustodyDailyRootStats:
    organization_id: str
    root_date: str
    artifact_count: int = 0
    event_count: int = 0
    leaf_count: int = 0
    merkle_root: str = ""
    signed_root: str = ""
    signature_alg: str = "hmac-sha256"
    signature_key_id: str | None = None
    created_at: str | None = None


def _resolve_signing_secret() -> tuple[str, str | None]:
    settings = get_settings()
    secret = (
        settings.custody_signing_secret
        or settings.internal_jwt_secret
        or settings.api_key_salt
        or "drovi-dev-custody-secret"
    )
    key_id = settings.custody_signing_key_id
    return secret, key_id


def _default_root_date(now: datetime) -> date:
    # Generate a sealed root for the previous UTC day so ingestion for that day is complete.
    return (now - timedelta(days=1)).date()


async def _load_daily_hashes(
    *,
    organization_id: str,
    root_date: date,
) -> tuple[list[str], int, int]:
    leaves: list[str] = []
    artifact_count = 0
    event_count = 0

    async with get_db_session() as session:
        artifact_rows = await session.execute(
            text(
                """
                SELECT sha256
                FROM evidence_artifact
                WHERE organization_id = :org_id
                  AND DATE(created_at AT TIME ZONE 'UTC') = :root_date
                  AND sha256 IS NOT NULL
                """
            ),
            {"org_id": organization_id, "root_date": root_date},
        )
        for row in artifact_rows.fetchall():
            value = str(row.sha256 or "").strip()
            if value:
                leaves.append(f"artifact:{value}")
                artifact_count += 1

        event_rows = await session.execute(
            text(
                """
                SELECT content_hash
                FROM unified_event
                WHERE organization_id = :org_id
                  AND DATE(COALESCE(captured_at, received_at) AT TIME ZONE 'UTC') = :root_date
                  AND content_hash IS NOT NULL
                """
            ),
            {"org_id": organization_id, "root_date": root_date},
        )
        for row in event_rows.fetchall():
            value = str(row.content_hash or "").strip()
            if value:
                leaves.append(f"event:{value}")
                event_count += 1

    return leaves, artifact_count, event_count


class CustodyIntegrityJob:
    """Computes and persists one daily custody Merkle root per organization."""

    async def run(
        self,
        *,
        organization_id: str,
        root_date: date | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        target_date = root_date or _default_root_date(now)
        secret, key_id = _resolve_signing_secret()

        leaves, artifact_count, event_count = await _load_daily_hashes(
            organization_id=organization_id,
            root_date=target_date,
        )
        root = merkle_root(leaves)
        signature = sign_merkle_root(
            organization_id=organization_id,
            root_date=target_date,
            merkle_root_value=root,
            leaf_count=len(leaves),
            secret=secret,
        )

        stats = CustodyDailyRootStats(
            organization_id=organization_id,
            root_date=target_date.isoformat(),
            artifact_count=artifact_count,
            event_count=event_count,
            leaf_count=len(leaves),
            merkle_root=root,
            signed_root=signature,
            signature_key_id=key_id,
            created_at=now.isoformat(),
        )

        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO custody_daily_root (
                        organization_id, root_date, artifact_count, event_count, leaf_count,
                        merkle_root, signed_root, signature_alg, signature_key_id, metadata, created_at
                    ) VALUES (
                        :organization_id, :root_date, :artifact_count, :event_count, :leaf_count,
                        :merkle_root, :signed_root, :signature_alg, :signature_key_id, CAST(:metadata AS jsonb), :created_at
                    )
                    ON CONFLICT (organization_id, root_date) DO UPDATE
                    SET artifact_count = EXCLUDED.artifact_count,
                        event_count = EXCLUDED.event_count,
                        leaf_count = EXCLUDED.leaf_count,
                        merkle_root = EXCLUDED.merkle_root,
                        signed_root = EXCLUDED.signed_root,
                        signature_alg = EXCLUDED.signature_alg,
                        signature_key_id = EXCLUDED.signature_key_id,
                        metadata = EXCLUDED.metadata,
                        created_at = EXCLUDED.created_at
                    """
                ),
                {
                    "organization_id": stats.organization_id,
                    "root_date": target_date,
                    "artifact_count": stats.artifact_count,
                    "event_count": stats.event_count,
                    "leaf_count": stats.leaf_count,
                    "merkle_root": stats.merkle_root,
                    "signed_root": stats.signed_root,
                    "signature_alg": stats.signature_alg,
                    "signature_key_id": stats.signature_key_id,
                    "metadata": json.dumps(
                        {
                            "generated_at": stats.created_at,
                            "sources": ["evidence_artifact.sha256", "unified_event.content_hash"],
                        }
                    ),
                    "created_at": now,
                },
            )

        logger.info(
            "Custody daily root updated",
            organization_id=stats.organization_id,
            root_date=stats.root_date,
            artifact_count=stats.artifact_count,
            event_count=stats.event_count,
            leaf_count=stats.leaf_count,
        )
        return stats.__dict__


_job: CustodyIntegrityJob | None = None


def get_custody_integrity_job() -> CustodyIntegrityJob:
    global _job
    if _job is None:
        _job = CustodyIntegrityJob()
    return _job
