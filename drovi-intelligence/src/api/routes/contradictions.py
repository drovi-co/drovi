"""Contradiction management API."""

from datetime import UTC, datetime
import hashlib
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.audit.log import record_audit_event
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.uio.manager import get_uio_manager

router = APIRouter(prefix="/contradictions", tags=["contradictions"])
logger = structlog.get_logger()


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and ctx.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _reliability_band(value: float | None) -> str:
    if value is None:
        return "unknown"
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


async def _lookup_source_reliability(
    *,
    organization_id: str,
    evidence_artifact_id: str | None,
) -> dict[str, Any]:
    if not evidence_artifact_id:
        return {
            "source_key": None,
            "score": None,
            "band": "unknown",
        }

    try:
        set_rls_context(organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                source_row = (
                    await session.execute(
                        text(
                            """
                            SELECT source_type
                            FROM evidence_artifact
                            WHERE organization_id = :org_id
                              AND id = :artifact_id
                            LIMIT 1
                            """
                        ),
                        {"org_id": organization_id, "artifact_id": evidence_artifact_id},
                    )
                ).fetchone()
                source_key = str(getattr(source_row, "source_type", "") or "").strip() or None
                if not source_key:
                    return {"source_key": None, "score": None, "band": "unknown"}

                reliability_row = (
                    await session.execute(
                        text(
                            """
                            SELECT reliability_score, corroboration_rate, false_positive_rate, last_evaluated_at
                            FROM source_reliability_profile
                            WHERE organization_id = :org_id
                              AND source_key = :source_key
                            LIMIT 1
                            """
                        ),
                        {"org_id": organization_id, "source_key": source_key},
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning(
            "Failed to resolve contradiction source reliability",
            organization_id=organization_id,
            evidence_artifact_id=evidence_artifact_id,
            error=str(exc),
        )
        return {"source_key": None, "score": None, "band": "unknown"}

    if not reliability_row:
        return {
            "source_key": source_key,
            "score": None,
            "band": "unknown",
        }
    score = _clamp(float(reliability_row.reliability_score or 0.0), 0.0, 1.0)
    return {
        "source_key": source_key,
        "score": round(score, 4),
        "band": _reliability_band(score),
        "corroboration_rate": round(_clamp(float(reliability_row.corroboration_rate or 0.0), 0.0, 1.0), 4),
        "false_positive_rate": round(_clamp(float(reliability_row.false_positive_rate or 0.0), 0.0, 1.0), 4),
        "last_evaluated_at": (
            reliability_row.last_evaluated_at.isoformat() if reliability_row.last_evaluated_at else None
        ),
    }


def _compute_contradiction_confidence(
    *,
    severity: str,
    has_evidence: bool,
    source_reliability_score: float | None,
) -> float:
    base = {
        "critical": 0.88,
        "high": 0.8,
        "medium": 0.68,
        "low": 0.56,
    }.get(str(severity or "medium").strip().lower(), 0.65)
    if has_evidence:
        base += 0.08
    if source_reliability_score is not None:
        base = (base * 0.6) + (_clamp(source_reliability_score, 0.0, 1.0) * 0.4)
    return round(_clamp(base, 0.0, 1.0), 4)


class ContradictionCreateRequest(BaseModel):
    organization_id: str
    uio_a_id: str
    uio_b_id: str
    contradiction_type: str
    severity: str = Field(default="medium")
    evidence_quote: str | None = None
    evidence_artifact_id: str | None = None
    detected_by: str | None = None


class ContradictionResolveRequest(BaseModel):
    organization_id: str
    resolution_reason: str
    resolved_by: str | None = None


@router.post("", response_model=dict)
async def create_contradiction(
    request: ContradictionCreateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    manager = await get_uio_manager(request.organization_id)
    try:
        contradiction_id = await manager.record_contradiction(
            uio_a_id=request.uio_a_id,
            uio_b_id=request.uio_b_id,
            contradiction_type=request.contradiction_type,
            severity=request.severity,
            evidence_quote=request.evidence_quote,
            evidence_artifact_id=request.evidence_artifact_id,
            detected_by=request.detected_by or getattr(ctx, "user_id", None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    hypothesis_job_id: str | None = None
    severity = str(request.severity or "medium").strip().lower()
    if severity in {"high", "critical"}:
        try:
            hypothesis_job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=request.organization_id,
                    job_type="hypothesis.generate",
                    payload={
                        "organization_id": request.organization_id,
                        "contradiction_id": contradiction_id,
                        "contradiction_type": request.contradiction_type,
                        "severity": severity,
                        "uio_a_id": request.uio_a_id,
                        "uio_b_id": request.uio_b_id,
                        "evidence_quote": request.evidence_quote,
                        "top_k": 3,
                        "min_score": 0.5,
                        "trigger": "contradiction_event",
                        "model_version": "hypothesis-v1",
                    },
                    priority=3,
                    max_attempts=3,
                    idempotency_key=f"hypothesis.generate:contradiction:{request.organization_id}:{contradiction_id}",
                    resource_key=f"hypothesis:contradiction:{contradiction_id}",
                )
            )
        except Exception as exc:  # pragma: no cover - defensive, non-blocking
            logger.warning(
                "Failed to enqueue contradiction hypothesis generation",
                organization_id=request.organization_id,
                contradiction_id=contradiction_id,
                error=str(exc),
            )
    reliability = await _lookup_source_reliability(
        organization_id=request.organization_id,
        evidence_artifact_id=request.evidence_artifact_id,
    )
    contradiction_confidence = _compute_contradiction_confidence(
        severity=severity,
        has_evidence=bool(request.evidence_quote or request.evidence_artifact_id),
        source_reliability_score=(
            float(reliability["score"]) if isinstance(reliability.get("score"), (float, int)) else None
        ),
    )
    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.contradiction.created",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="contradiction",
            resource_id=contradiction_id,
            metadata={
                "contradiction_type": request.contradiction_type,
                "severity": severity,
                "uio_a_id": request.uio_a_id,
                "uio_b_id": request.uio_b_id,
                "has_evidence_quote": bool(request.evidence_quote),
                "has_evidence_artifact": bool(request.evidence_artifact_id),
                "contradiction_confidence": contradiction_confidence,
                "source_reliability_score": reliability.get("score"),
                "source_reliability_band": reliability.get("band"),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record contradiction creation audit event",
            organization_id=request.organization_id,
            contradiction_id=contradiction_id,
            error=str(exc),
        )

    return {
        "success": True,
        "contradiction_id": contradiction_id,
        "hypothesis_job_id": hypothesis_job_id,
        "detected_at": datetime.now(UTC).isoformat(),
        "contradiction_confidence": contradiction_confidence,
        "source_reliability": reliability,
    }


@router.post("/{contradiction_id}/resolve", response_model=dict)
async def resolve_contradiction(
    contradiction_id: str,
    request: ContradictionResolveRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    manager = await get_uio_manager(request.organization_id)
    resolved = await manager.resolve_contradiction(
        contradiction_id=contradiction_id,
        resolution_reason=request.resolution_reason,
        resolved_by=request.resolved_by or getattr(ctx, "user_id", None),
    )
    if not resolved:
        raise HTTPException(status_code=404, detail="Contradiction not found")

    try:
        await record_audit_event(
            organization_id=request.organization_id,
            action="brain.contradiction.resolved",
            actor_type="api_key" if ctx.key_id else "system",
            actor_id=ctx.key_id or ctx.auth_subject_id,
            resource_type="contradiction",
            resource_id=contradiction_id,
            metadata={
                "resolution_reason_digest": hashlib.sha256(
                    request.resolution_reason.encode("utf-8")
                ).hexdigest(),
            },
        )
    except Exception as exc:  # pragma: no cover - non-blocking audit
        logger.warning(
            "Failed to record contradiction resolution audit event",
            organization_id=request.organization_id,
            contradiction_id=contradiction_id,
            error=str(exc),
        )

    return {
        "success": True,
        "contradiction_id": contradiction_id,
        "resolved_at": datetime.now(UTC).isoformat(),
    }
