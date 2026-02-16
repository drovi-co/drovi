from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import text

from src.agentos.control_plane import emit_control_plane_audit_event
from src.db.client import get_db_session
from src.kernel.errors import ValidationError
from src.kernel.time import utc_now
from src.monitoring import get_metrics

from .common import (
    APPROVAL_PATTERN,
    MENTION_PATTERN,
    build_continuity_key,
    build_external_thread_id,
    coerce_datetime,
    normalize_recipients,
    row_to_dict,
)
from .models import (
    AgentInboxThreadRecord,
    AgentMessageEventRecord,
    ChannelType,
    InboundChannelEventResult,
    ParsedChannelAction,
)


class AgentPresenceInboxMixin:
    async def list_threads(
        self,
        *,
        organization_id: str,
        identity_id: str | None = None,
        channel_type: ChannelType | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AgentInboxThreadRecord]:
        query = """
            SELECT id, organization_id, identity_id, channel_type, external_thread_id, continuity_key,
                   subject, status, assigned_run_id, last_message_at, metadata, created_at, updated_at
            FROM agent_inbox_thread
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if identity_id:
            query += " AND identity_id = :identity_id"
            params["identity_id"] = identity_id
        if channel_type:
            query += " AND channel_type = :channel_type"
            params["channel_type"] = channel_type
        if status:
            query += " AND status = :status"
            params["status"] = status
        query += " ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [AgentInboxThreadRecord.model_validate(row_to_dict(row)) for row in rows]

    async def list_thread_messages(
        self,
        *,
        organization_id: str,
        thread_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[AgentMessageEventRecord]:
        await self.get_thread(organization_id=organization_id, thread_id=thread_id)
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, thread_id, identity_id, channel_binding_id,
                           direction, event_type, sender, recipients, subject, body_text, body_html,
                           raw_payload, parsed_task, policy_status, approval_request_id, run_id,
                           message_status, occurred_at, created_at
                    FROM agent_message_event
                    WHERE organization_id = :organization_id
                      AND thread_id = :thread_id
                    ORDER BY occurred_at ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "thread_id": thread_id,
                    "limit": max(1, min(limit, 500)),
                    "offset": max(0, offset),
                },
            )
            rows = result.fetchall()
        return [AgentMessageEventRecord.model_validate(row_to_dict(row)) for row in rows]

    def parse_channel_action(self, *, body_text: str, channel_type: ChannelType) -> ParsedChannelAction:
        text = body_text.strip()
        if not text:
            return ParsedChannelAction(intent="none", confidence=0.0)

        match = APPROVAL_PATTERN.match(text)
        if match:
            decision = "approved" if match.group(1).lower() == "approve" else "denied"
            return ParsedChannelAction(
                intent="approval",
                summary=f"{decision} {match.group(2)}",
                confidence=0.98,
                approval_id=match.group(2),
                approval_decision=decision,
                approval_reason=(match.group(3) or "").strip() or None,
                mentions=[],
                metadata={"channel_type": channel_type},
            )

        mentions = sorted(set(m.lower() for m in MENTION_PATTERN.findall(text)))
        lowered = text.lower()
        is_question = "?" in text or lowered.startswith(("what", "how", "why", "can ", "could ", "would "))
        task_keywords = ("please", "need", "follow up", "send", "draft", "prepare", "update", "check")
        is_task = any(keyword in lowered for keyword in task_keywords)

        if is_question:
            return ParsedChannelAction(
                intent="question",
                summary=text[:200],
                confidence=0.76,
                mentions=mentions,
                metadata={"channel_type": channel_type},
            )
        if is_task:
            return ParsedChannelAction(
                intent="task",
                summary=text[:200],
                confidence=0.72,
                mentions=mentions,
                metadata={"channel_type": channel_type},
            )
        return ParsedChannelAction(
            intent="none",
            summary=text[:200],
            confidence=0.25,
            mentions=mentions,
            metadata={"channel_type": channel_type},
        )

    async def ingest_channel_event(
        self,
        *,
        organization_id: str,
        channel_type: ChannelType,
        sender: str,
        body_text: str,
        subject: str | None = None,
        body_html: str | None = None,
        recipients: list[str] | None = None,
        identity_id: str | None = None,
        channel_target: str | None = None,
        channel_account_id: str | None = None,
        external_thread_id: str | None = None,
        continuity_key: str | None = None,
        raw_payload: dict[str, Any] | None = None,
        occurred_at: datetime | str | None = None,
    ) -> InboundChannelEventResult:
        del channel_account_id
        clean_sender = sender.strip().lower()
        if "@" not in clean_sender and channel_type == "email":
            raise ValidationError(
                code="agentos.presence.invalid_sender",
                message="Inbound email sender is invalid",
            )
        if not body_text.strip():
            raise ValidationError(
                code="agentos.presence.empty_message",
                message="Inbound message body is required",
            )

        identity, binding = await self._resolve_identity_and_binding(
            organization_id=organization_id,
            channel_type=channel_type,
            identity_id=identity_id,
            channel_target=channel_target,
            recipients=recipients,
        )

        occurred = coerce_datetime(occurred_at)
        resolved_thread_id = external_thread_id or build_external_thread_id(
            channel_type=channel_type,
            sender=clean_sender,
            subject=subject,
            explicit_target=channel_target,
            raw_payload=raw_payload,
        )
        resolved_continuity = continuity_key or build_continuity_key(
            channel_type=channel_type,
            sender=clean_sender,
            channel_target=channel_target or binding.channel_target,
            subject=subject,
        )

        thread = await self._resolve_or_create_thread(
            organization_id=organization_id,
            identity_id=identity.id,
            channel_type=channel_type,
            external_thread_id=resolved_thread_id,
            continuity_key=resolved_continuity,
            subject=subject,
            occurred_at=occurred,
        )

        parsed = self.parse_channel_action(body_text=body_text, channel_type=channel_type)
        approval_applied: dict[str, Any] | None = None
        if parsed.intent == "approval" and parsed.approval_id and parsed.approval_decision:
            approval_applied = await self._apply_approval_action(
                organization_id=organization_id,
                approval_id=parsed.approval_id,
                decision=parsed.approval_decision,
                approver_id=f"{channel_type}:{clean_sender}",
                reason=parsed.approval_reason,
                channel_type=channel_type,
            )

        message = await self._insert_message_event(
            organization_id=organization_id,
            thread_id=thread.id,
            identity_id=identity.id,
            channel_binding_id=binding.id if binding else None,
            direction="inbound",
            event_type=f"{channel_type}.message.received",
            sender=clean_sender,
            recipients=normalize_recipients(recipients),
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            raw_payload=raw_payload or {},
            parsed_task=parsed.model_dump(mode="json"),
            message_status="received",
            occurred_at=occurred,
        )
        await self._touch_thread(
            organization_id=organization_id,
            thread_id=thread.id,
            subject=subject or thread.subject,
            occurred_at=occurred,
        )

        await self._publish_inbox_event(
            organization_id=organization_id,
            channel_type=channel_type,
            event_type="agent.inbox.message.received",
            payload={
                "thread_id": thread.id,
                "message_id": message.id,
                "identity_id": identity.id,
                "binding_id": binding.id if binding else None,
                "sender": clean_sender,
                "subject": subject,
                "parsed_action": parsed.model_dump(mode="json"),
            },
        )

        lag_seconds = max((utc_now() - occurred).total_seconds(), 0.0)
        metrics = get_metrics()
        metrics.track_agent_inbox_event(
            channel_type=channel_type,
            direction="inbound",
            status="received",
            lag_seconds=lag_seconds,
        )

        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.inbox.message_ingested",
            actor_id=None,
            resource_type="agent_inbox_thread",
            resource_id=thread.id,
            metadata={"channel_type": channel_type, "message_id": message.id},
        )
        return InboundChannelEventResult(
            thread=thread,
            message=message,
            parsed_action=parsed,
            approval_applied=approval_applied,
        )
