"""Guardrails API endpoints for compose and inbound checks."""

from __future__ import annotations

import asyncio

import structlog
from fastapi import APIRouter, Depends, HTTPException

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.audit.log import record_audit_event
from src.guardrails import (
    ComposeGuardrailRequest,
    ComposeGuardrailResponse,
    DataMinimizationRequest,
    DataMinimizationResponse,
    InboundGuardrailRequest,
    InboundGuardrailResponse,
    PolicyContext,
    assess_inbound_risk,
    apply_data_minimization,
    check_contradictions,
    detect_pii,
    evaluate_policy,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/guardrails", tags=["Guardrails"])

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
_ACTION_RANK = {"allow": 1, "require_approval": 2, "block": 3}


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


def _max_severity(severities: list[str]) -> str | None:
    if not severities:
        return None
    return max(severities, key=lambda s: _SEVERITY_RANK.get(s, 0))


def _resolve_action(decisions) -> str:
    if not decisions:
        return "allow"
    return max(decisions, key=lambda d: _ACTION_RANK.get(d.action, 0)).action


async def _audit_events(
    organization_id: str,
    ctx: APIKeyContext,
    action: str,
    metadata: dict,
    resource_type: str,
) -> None:
    try:
        await record_audit_event(
            organization_id=organization_id,
            action=action,
            actor_type="api_key",
            actor_id=ctx.key_id,
            resource_type=resource_type,
            resource_id=None,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("Failed to record audit event", action=action, error=str(exc))


@router.post("/compose/check", response_model=ComposeGuardrailResponse)
async def compose_guardrail_check(
    request: ComposeGuardrailRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> ComposeGuardrailResponse:
    _validate_org_id(ctx, request.organization_id)

    pii_findings = detect_pii(request.content)
    contradictions = await check_contradictions(
        organization_id=request.organization_id,
        draft_content=request.content,
    )

    blocked_pii_types = [finding.type for finding in pii_findings if not finding.allowed]
    contradiction_severity = _max_severity([c.severity for c in contradictions])

    policy_context = PolicyContext(
        direction="outbound",
        channel=request.channel,
        pii_types=blocked_pii_types,
        contradiction_severity=contradiction_severity,
        fraud_score=None,
        actor_role=request.actor_role,
        sensitivity=request.sensitivity,
        action_tier=request.action_tier,
        action_type=request.action_type,
    )
    policy_decisions = evaluate_policy(policy_context)
    overall_action = _resolve_action(policy_decisions)

    audit_tasks = []
    if pii_findings:
        audit_tasks.append(
            _audit_events(
                request.organization_id,
                ctx,
                "guardrail.pii_detected",
                {"count": len(pii_findings), "types": blocked_pii_types},
                resource_type="compose_check",
            )
        )
    for contradiction in contradictions:
        audit_tasks.append(
            _audit_events(
                request.organization_id,
                ctx,
                "guardrail.contradiction_detected",
                {
                    "uio_id": contradiction.uio_id,
                    "uio_type": contradiction.uio_type,
                    "severity": contradiction.severity,
                    "type": contradiction.contradiction_type,
                },
                resource_type="compose_check",
            )
        )
    for decision in policy_decisions:
        audit_tasks.append(
            _audit_events(
                request.organization_id,
                ctx,
                "guardrail.policy_decision",
                {
                    "rule_id": decision.rule_id,
                    "action": decision.action,
                    "severity": decision.severity,
                },
                resource_type="compose_check",
            )
        )

    if audit_tasks:
        await asyncio.gather(*audit_tasks)

    return ComposeGuardrailResponse(
        contradictions=contradictions,
        pii_findings=pii_findings,
        policy_decisions=policy_decisions,
        overall_action=overall_action,
    )


@router.post("/minimize", response_model=DataMinimizationResponse)
async def minimize_content(
    request: DataMinimizationRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> DataMinimizationResponse:
    _validate_org_id(ctx, request.organization_id)
    redacted_content, findings, applied = apply_data_minimization(
        request.content,
        override_redact=request.redact,
    )
    if applied:
        await _audit_events(
            request.organization_id,
            ctx,
            "guardrail.data_minimized",
            {"count": len([f for f in findings if not f.allowed])},
            resource_type="data_minimization",
        )
    return DataMinimizationResponse(
        redacted_content=redacted_content,
        findings=findings,
        applied=applied,
    )


@router.post("/inbound/check", response_model=InboundGuardrailResponse)
async def inbound_guardrail_check(
    request: InboundGuardrailRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> InboundGuardrailResponse:
    _validate_org_id(ctx, request.organization_id)

    assessment = assess_inbound_risk(
        content=request.content,
        subject=request.subject,
        sender_email=request.sender_email,
        sender_name=request.sender_name,
        known_domains=request.known_domains,
    )

    policy_context = PolicyContext(
        direction="inbound",
        channel=None,
        pii_types=[],
        contradiction_severity=None,
        fraud_score=assessment.overall_score,
    )
    policy_decisions = evaluate_policy(policy_context)
    overall_action = _resolve_action(policy_decisions)

    audit_tasks = []
    for signal in assessment.signals:
        audit_tasks.append(
            _audit_events(
                request.organization_id,
                ctx,
                "guardrail.fraud_signal",
                {"type": signal.type, "score": signal.score, "severity": signal.severity},
                resource_type="inbound_check",
            )
        )
    for decision in policy_decisions:
        audit_tasks.append(
            _audit_events(
                request.organization_id,
                ctx,
                "guardrail.policy_decision",
                {
                    "rule_id": decision.rule_id,
                    "action": decision.action,
                    "severity": decision.severity,
                },
                resource_type="inbound_check",
            )
        )

    if audit_tasks:
        await asyncio.gather(*audit_tasks)

    return InboundGuardrailResponse(
        fraud_signals=assessment.signals,
        policy_decisions=policy_decisions,
        overall_action=overall_action,
    )
