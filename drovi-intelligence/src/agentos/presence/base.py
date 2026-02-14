from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import text
import structlog

from src.agentos.control_plane import ActionReceiptService, ApprovalService, PolicyDecisionEngine
from src.contexts.workflows.infrastructure.client import get_temporal_client
from src.db.client import get_db_session
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now
from src.monitoring import get_metrics
from src.streaming import get_kafka_producer, is_streaming_enabled

from .common import row_to_dict, topic_key
from .models import AgentInboxThreadRecord, AgentMessageEventRecord

logger = structlog.get_logger()


class AgentPresenceBase:
    """Shared persistence + transport helpers for channel presence services."""

    def __init__(
        self,
        *,
        policy_engine: PolicyDecisionEngine | None = None,
        approvals: ApprovalService | None = None,
        receipts: ActionReceiptService | None = None,
    ) -> None:
        self._policy_engine = policy_engine or PolicyDecisionEngine()
        self._approvals = approvals or ApprovalService()
        self._receipts = receipts or ActionReceiptService()

    async def _resolve_or_create_thread(
        self,
        *,
        organization_id: str,
        identity_id: str,
        channel_type: str,
        external_thread_id: str,
        continuity_key: str | None,
        subject: str | None,
        occurred_at: datetime,
    ) -> AgentInboxThreadRecord:
        async with get_db_session() as session:
            existing_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, external_thread_id, continuity_key,
                           subject, status, assigned_run_id, last_message_at, metadata, created_at, updated_at
                    FROM agent_inbox_thread
                    WHERE organization_id = :organization_id
                      AND identity_id = :identity_id
                      AND channel_type = :channel_type
                      AND external_thread_id = :external_thread_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "external_thread_id": external_thread_id,
                },
            )
            row = existing_result.fetchone()
            if row:
                return AgentInboxThreadRecord.model_validate(row_to_dict(row))

            thread_id = f"agthr_{organization_id[-6:]}_{utc_now().strftime('%H%M%S%f')[:12]}"
            now = utc_now()
            await session.execute(
                text(
                    """
                    INSERT INTO agent_inbox_thread (
                        id, organization_id, identity_id, channel_type, external_thread_id,
                        continuity_key, subject, status, assigned_run_id,
                        last_message_at, metadata, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :identity_id, :channel_type, :external_thread_id,
                        :continuity_key, :subject, 'open', NULL,
                        :last_message_at, '{}'::jsonb, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": thread_id,
                    "organization_id": organization_id,
                    "identity_id": identity_id,
                    "channel_type": channel_type,
                    "external_thread_id": external_thread_id,
                    "continuity_key": continuity_key,
                    "subject": subject,
                    "last_message_at": occurred_at,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        return await self.get_thread(organization_id=organization_id, thread_id=thread_id)

    async def _touch_thread(
        self,
        *,
        organization_id: str,
        thread_id: str,
        subject: str | None,
        occurred_at: datetime,
    ) -> None:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_inbox_thread
                    SET subject = COALESCE(:subject, subject),
                        last_message_at = :last_message_at,
                        updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND id = :thread_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "thread_id": thread_id,
                    "subject": subject,
                    "last_message_at": occurred_at,
                    "updated_at": utc_now(),
                },
            )
            await session.commit()

    async def _insert_message_event(
        self,
        *,
        organization_id: str,
        thread_id: str,
        identity_id: str,
        channel_binding_id: str | None,
        direction: str,
        event_type: str,
        sender: str | None,
        recipients: list[str],
        subject: str | None,
        body_text: str | None,
        body_html: str | None,
        raw_payload: dict[str, Any],
        parsed_task: dict[str, Any],
        policy_status: str | None = None,
        approval_request_id: str | None = None,
        run_id: str | None = None,
        message_status: str = "received",
        occurred_at: datetime | None = None,
    ) -> AgentMessageEventRecord:
        message_id = f"agmsg_{organization_id[-6:]}_{utc_now().strftime('%H%M%S%f')[:12]}"
        when = occurred_at or utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_message_event (
                        id, organization_id, thread_id, identity_id, channel_binding_id,
                        direction, event_type, sender, recipients, subject, body_text, body_html,
                        raw_payload, parsed_task, policy_status, approval_request_id, run_id,
                        message_status, occurred_at, created_at
                    ) VALUES (
                        :id, :organization_id, :thread_id, :identity_id, :channel_binding_id,
                        :direction, :event_type, :sender, CAST(:recipients AS JSONB), :subject, :body_text, :body_html,
                        CAST(:raw_payload AS JSONB), CAST(:parsed_task AS JSONB), :policy_status, :approval_request_id, :run_id,
                        :message_status, :occurred_at, :created_at
                    )
                    """
                ),
                {
                    "id": message_id,
                    "organization_id": organization_id,
                    "thread_id": thread_id,
                    "identity_id": identity_id,
                    "channel_binding_id": channel_binding_id,
                    "direction": direction,
                    "event_type": event_type,
                    "sender": sender,
                    "recipients": json_dumps_canonical(recipients),
                    "subject": subject,
                    "body_text": body_text,
                    "body_html": body_html,
                    "raw_payload": json_dumps_canonical(raw_payload),
                    "parsed_task": json_dumps_canonical(parsed_task),
                    "policy_status": policy_status,
                    "approval_request_id": approval_request_id,
                    "run_id": run_id,
                    "message_status": message_status,
                    "occurred_at": when,
                    "created_at": utc_now(),
                },
            )
            await session.commit()
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, thread_id, identity_id, channel_binding_id,
                           direction, event_type, sender, recipients, subject, body_text, body_html,
                           raw_payload, parsed_task, policy_status, approval_request_id, run_id,
                           message_status, occurred_at, created_at
                    FROM agent_message_event
                    WHERE id = :id
                    """
                ),
                {"id": message_id},
            )
            row = result.fetchone()
        return AgentMessageEventRecord.model_validate(row_to_dict(row))

    async def _apply_approval_action(
        self,
        *,
        organization_id: str,
        approval_id: str,
        decision: str,
        approver_id: str,
        reason: str | None,
        channel_type: str,
    ) -> dict[str, Any]:
        approval = await self._approvals.decide_request(
            organization_id=organization_id,
            approval_id=approval_id,
            decision="approved" if decision == "approved" else "denied",
            approver_id=approver_id,
            reason=reason,
        )
        now = utc_now()
        if approval.requested_at:
            latency = max((now - approval.requested_at).total_seconds(), 0.0)
            get_metrics().observe_agent_approval_latency(channel_type=channel_type, seconds=latency)
        if approval.run_id:
            await self._signal_runtime_for_approval(run_id=approval.run_id, decision=approval.status)
        return approval.model_dump(mode="json")

    async def _signal_runtime_for_approval(self, *, run_id: str, decision: str) -> None:
        signal_name = "resume" if decision == "approved" else "cancel"
        try:
            client = await get_temporal_client()
            handle = client.get_workflow_handle(f"agent-run:{run_id}")
            await handle.signal(signal_name)
        except Exception as exc:
            logger.warning(
                "Failed to signal runtime from channel approval",
                run_id=run_id,
                decision=decision,
                error=str(exc),
            )

    async def _publish_inbox_event(
        self,
        *,
        organization_id: str,
        channel_type: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if not is_streaming_enabled():
            return
        try:
            producer = await get_kafka_producer()
            await producer.produce_agent_inbox_event(
                organization_id=organization_id,
                channel_type=channel_type,
                event_type=event_type,
                payload=payload,
                source_id=topic_key(channel_type, organization_id),
            )
        except Exception as exc:
            logger.warning(
                "Failed to publish agent inbox event",
                organization_id=organization_id,
                channel_type=channel_type,
                event_type=event_type,
                error=str(exc),
            )

    async def get_thread(self, *, organization_id: str, thread_id: str) -> AgentInboxThreadRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, identity_id, channel_type, external_thread_id, continuity_key,
                           subject, status, assigned_run_id, last_message_at, metadata, created_at, updated_at
                    FROM agent_inbox_thread
                    WHERE organization_id = :organization_id
                      AND id = :id
                    """
                ),
                {"organization_id": organization_id, "id": thread_id},
            )
            row = result.fetchone()
        if row is None:
            from src.kernel.errors import NotFoundError

            raise NotFoundError(
                code="agentos.presence.thread_not_found",
                message="Agent inbox thread not found",
                meta={"thread_id": thread_id},
            )
        return AgentInboxThreadRecord.model_validate(row_to_dict(row))
