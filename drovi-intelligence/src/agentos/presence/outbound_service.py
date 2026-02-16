from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.actuation.webhook import send_actuation_webhook
from src.agentos.control_plane import emit_control_plane_audit_event
from src.config import get_settings
from src.db.client import get_db_session
from src.kernel.errors import ValidationError
from src.kernel.time import utc_now
from src.monitoring import get_metrics
from src.notifications.resend import send_resend_email

from .common import normalize_email, normalize_recipients


class AgentPresenceOutboundMixin:
    async def reply_to_thread(
        self,
        *,
        organization_id: str,
        thread_id: str,
        actor_id: str | None,
        message: str,
        html: str | None = None,
        evidence_links: list[str] | None = None,
        run_id: str | None = None,
        recipients: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        if not message.strip():
            raise ValidationError(
                code="agentos.presence.reply_empty",
                message="Reply message cannot be empty",
            )
        thread = await self.get_thread(organization_id=organization_id, thread_id=thread_id)
        identity = await self.get_identity(organization_id=organization_id, identity_id=thread.identity_id)
        binding = await self._resolve_thread_binding(organization_id=organization_id, thread=thread)
        tool_id = {
            "email": "email.send",
            "slack": "slack.post_message",
            "teams": "teams.post_message",
        }[thread.channel_type]

        effective_recipients = normalize_recipients(recipients)
        if thread.channel_type == "email" and not effective_recipients:
            effective_recipients = await self._derive_email_recipients(
                organization_id=organization_id,
                thread_id=thread_id,
            )
        evidence = {"references": evidence_links or []}
        decision = await self._policy_engine.decide(
            organization_id=organization_id,
            deployment_id=identity.deployment_id,
            tool_id=tool_id,
            evidence_refs=evidence,
            metadata={"thread_id": thread_id, "channel_type": thread.channel_type, "run_id": run_id},
        )
        receipt = await self._receipts.create_receipt(
            organization_id=organization_id,
            run_id=run_id,
            deployment_id=identity.deployment_id,
            tool_id=tool_id,
            request_payload={
                "thread_id": thread_id,
                "message": message,
                "recipients": effective_recipients,
                "channel_target": binding.channel_target if binding else None,
            },
            evidence_refs=evidence,
            policy_result=decision.model_dump(mode="json"),
            final_status="policy_evaluated",
        )

        if decision.action == "deny":
            await self._receipts.finalize_receipt(
                organization_id=organization_id,
                receipt_id=receipt.id,
                final_status="denied",
                result_payload={"code": decision.code, "reason": decision.reason},
            )
            get_metrics().track_agent_channel_action_failure(
                channel_type=thread.channel_type,
                reason=decision.code,
            )
            raise ValidationError(
                code="agentos.presence.reply_denied",
                message=f"Outbound action denied: {decision.reason}",
                status_code=403,
                meta={"policy_code": decision.code},
            )

        if decision.action == "require_approval":
            approval = await self._approvals.create_request(
                organization_id=organization_id,
                run_id=run_id,
                deployment_id=identity.deployment_id,
                tool_id=tool_id,
                action_tier=decision.action_tier,
                reason=decision.reason,
                requested_by=actor_id,
                sla_minutes=15,
                escalation_path={"source": "agent_inbox_reply", "thread_id": thread_id},
                metadata={"channel_type": thread.channel_type, "thread_id": thread_id},
            )
            await self._receipts.finalize_receipt(
                organization_id=organization_id,
                receipt_id=receipt.id,
                final_status="waiting_approval",
                approval_request_id=approval.id,
                result_payload={"approval_request_id": approval.id},
            )
            return await self._insert_message_event(
                organization_id=organization_id,
                thread_id=thread_id,
                identity_id=identity.id,
                channel_binding_id=binding.id if binding else None,
                direction="system",
                event_type=f"{thread.channel_type}.message.waiting_approval",
                sender=identity.email_address,
                recipients=effective_recipients,
                subject=thread.subject,
                body_text=f"Reply queued awaiting approval {approval.id}",
                body_html=None,
                raw_payload={"approval_request_id": approval.id},
                parsed_task={"intent": "approval"},
                policy_status=decision.code,
                approval_request_id=approval.id,
                run_id=run_id,
                message_status="requires_approval",
                occurred_at=utc_now(),
            )

        await self._enforce_outbound_policy(
            channel_type=thread.channel_type,
            recipients=effective_recipients,
            binding_config=binding.config,
            metadata=metadata or {},
        )
        send_ok = await self._send_outbound(
            channel_type=thread.channel_type,
            channel_target=binding.channel_target,
            channel_account_id=binding.channel_account_id,
            organization_id=organization_id,
            identity_id=identity.id,
            recipients=effective_recipients,
            subject=thread.subject,
            body_text=message,
            body_html=html,
            thread_external_id=thread.external_thread_id,
            metadata=metadata or {},
        )
        final_status = "sent" if send_ok else "failed"
        await self._receipts.finalize_receipt(
            organization_id=organization_id,
            receipt_id=receipt.id,
            final_status=final_status,
            result_payload={"sent": send_ok},
        )

        message_record = await self._insert_message_event(
            organization_id=organization_id,
            thread_id=thread_id,
            identity_id=identity.id,
            channel_binding_id=binding.id if binding else None,
            direction="outbound",
            event_type=f"{thread.channel_type}.message.sent" if send_ok else f"{thread.channel_type}.message.failed",
            sender=identity.email_address or identity.display_name,
            recipients=effective_recipients,
            subject=thread.subject,
            body_text=message,
            body_html=html,
            raw_payload={"metadata": metadata or {}, "evidence_links": evidence_links or [], "receipt_id": receipt.id},
            parsed_task={},
            policy_status=decision.code,
            run_id=run_id,
            message_status="sent" if send_ok else "failed",
            occurred_at=utc_now(),
        )
        await self._touch_thread(
            organization_id=organization_id,
            thread_id=thread_id,
            subject=thread.subject,
            occurred_at=utc_now(),
        )

        if thread.last_message_at:
            response_sla = max((utc_now() - thread.last_message_at).total_seconds(), 0.0)
            get_metrics().observe_agent_channel_response_sla(
                channel_type=thread.channel_type,
                seconds=response_sla,
            )
        get_metrics().track_agent_inbox_event(
            channel_type=thread.channel_type,
            direction="outbound",
            status="sent" if send_ok else "failed",
            lag_seconds=None,
        )
        await self._publish_inbox_event(
            organization_id=organization_id,
            channel_type=thread.channel_type,
            event_type="agent.inbox.message.outbound",
            payload={
                "thread_id": thread_id,
                "message_id": message_record.id,
                "run_id": run_id,
                "status": final_status,
                "evidence_links": evidence_links or [],
            },
        )
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.inbox.reply_sent" if send_ok else "agentos.inbox.reply_failed",
            actor_id=actor_id,
            resource_type="agent_inbox_thread",
            resource_id=thread_id,
            metadata={"message_id": message_record.id, "channel_type": thread.channel_type},
        )
        return message_record

    async def _derive_email_recipients(self, *, organization_id: str, thread_id: str) -> list[str]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT sender
                    FROM agent_message_event
                    WHERE organization_id = :organization_id
                      AND thread_id = :thread_id
                      AND direction = 'inbound'
                      AND sender IS NOT NULL
                    ORDER BY occurred_at DESC
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "thread_id": thread_id},
            )
            row = result.fetchone()
        if row and row.sender:
            sender = normalize_email(str(row.sender))
            if sender:
                return [sender]
        raise ValidationError(
            code="agentos.presence.reply_recipient_missing",
            message="Unable to derive email recipient from thread history",
        )

    async def _enforce_outbound_policy(
        self,
        *,
        channel_type: str,
        recipients: list[str],
        binding_config: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        settings = get_settings()
        blocked_domains = {d.strip().lower() for d in settings.agent_channel_blocked_domains if d.strip()}
        allowed_domains = {d.strip().lower() for d in settings.agent_channel_allowed_domains if d.strip()}
        if channel_type == "email":
            for recipient in recipients:
                if "@" not in recipient:
                    raise ValidationError(
                        code="agentos.presence.invalid_recipient",
                        message=f"Invalid recipient email: {recipient}",
                    )
                domain = recipient.split("@", 1)[1].lower()
                if domain in blocked_domains:
                    raise ValidationError(
                        code="agentos.presence.recipient_blocked",
                        message=f"Recipient domain is blocked: {domain}",
                        status_code=403,
                    )
                if allowed_domains and domain not in allowed_domains:
                    raise ValidationError(
                        code="agentos.presence.recipient_not_allowed",
                        message=f"Recipient domain is not in allowlist: {domain}",
                        status_code=403,
                    )
        sensitivity = str(metadata.get("sensitivity") or "").lower()
        if sensitivity in {"restricted", "secret"} and not bool(binding_config.get("allow_sensitive_send", False)):
            raise ValidationError(
                code="agentos.presence.sensitivity_blocked",
                message="Sensitive outbound message blocked by channel policy",
                status_code=403,
            )

    async def _send_outbound(
        self,
        *,
        channel_type: str,
        channel_target: str,
        channel_account_id: str | None,
        organization_id: str,
        identity_id: str,
        recipients: list[str],
        subject: str | None,
        body_text: str,
        body_html: str | None,
        thread_external_id: str,
        metadata: dict[str, Any],
    ) -> bool:
        if channel_type == "email":
            rendered_html = body_html or f"<p>{body_text}</p>"
            tags = {
                "type": "agent_inbox_reply",
                "thread_id": thread_external_id,
                "identity_id": identity_id,
            }
            tags.update({k: str(v) for k, v in metadata.items() if isinstance(v, (str, int, float, bool))})
            return await send_resend_email(
                to_emails=recipients,
                subject=subject or "Re: Agent Update",
                html_body=rendered_html,
                text_body=body_text,
                tags=tags,
            )

        response = await send_actuation_webhook(
            driver=channel_type,
            action="send_message",
            organization_id=organization_id,
            payload={
                "channel_target": channel_target,
                "channel_account_id": channel_account_id,
                "thread_id": thread_external_id,
                "text": body_text,
                "metadata": metadata,
            },
        )
        return str(response.get("status") or "").lower() in {"sent", "ok", "queued"}
