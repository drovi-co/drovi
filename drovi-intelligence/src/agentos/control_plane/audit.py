from __future__ import annotations

from typing import Any

import structlog

from src.audit.log import record_audit_event

logger = structlog.get_logger()


async def emit_control_plane_audit_event(
    *,
    organization_id: str,
    action: str,
    actor_id: str | None,
    resource_type: str,
    resource_id: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Emit an audit event without failing the request on logging errors."""

    try:
        await record_audit_event(
            organization_id=organization_id,
            action=action,
            actor_type="user" if actor_id else "system",
            actor_id=actor_id,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=metadata or {},
        )
    except Exception as exc:
        logger.warning(
            "Failed to emit AgentOS control-plane audit event",
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            error=str(exc),
        )

