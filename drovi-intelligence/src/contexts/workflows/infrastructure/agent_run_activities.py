from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text
from temporalio import activity
from temporalio.exceptions import ApplicationError

from src.agentos.browser import BrowserActionRequest, BrowserCreateSessionRequest, BrowserService
from src.agentos.control_plane import ActionReceiptService, ApprovalService, PolicyDecisionEngine
from src.agentos.desktop import DesktopActionRequest, DesktopBridgeService
from src.agentos.work_products import WorkProductDeliveryRequest, WorkProductGenerateRequest, WorkProductService
from src.db.client import get_db_session
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

logger = structlog.get_logger()

_policy_engine = PolicyDecisionEngine()
_approval_service = ApprovalService()
_receipt_service = ActionReceiptService()
_browser_service = BrowserService()
_desktop_service = DesktopBridgeService()
_work_product_service = WorkProductService()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_redis():
    try:
        import redis.asyncio as redis

        from src.config import get_settings

        return redis.from_url(str(get_settings().redis_url))
    except Exception:
        return None


@activity.defn(name="agent_runs.update_status")
async def update_run_status(req: dict[str, Any]) -> None:
    run_id = str(req.get("run_id") or "")
    organization_id = str(req.get("organization_id") or "")
    status = str(req.get("status") or "")
    if not run_id or not organization_id or not status:
        raise ValueError("agent_runs.update_status requires run_id, organization_id and status")

    now = utc_now()
    metadata = req.get("metadata") or {}
    failure_reason = req.get("failure_reason")

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = :status,
                    started_at = CASE
                        WHEN :status = 'running' AND started_at IS NULL THEN :now
                        ELSE started_at
                    END,
                    completed_at = CASE
                        WHEN :status IN ('completed', 'failed', 'cancelled') THEN :now
                        ELSE completed_at
                    END,
                    failure_reason = :failure_reason,
                    metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB),
                    updated_at = :now
                WHERE id = :run_id
                  AND organization_id = :organization_id
                """
            ),
            {
                "run_id": run_id,
                "organization_id": organization_id,
                "status": status,
                "failure_reason": failure_reason,
                "metadata": json_dumps_canonical(metadata),
                "now": now,
            },
        )
        await session.commit()


@activity.defn(name="agent_runs.record_step")
async def record_run_step(req: dict[str, Any]) -> str:
    run_id = str(req.get("run_id") or "")
    organization_id = str(req.get("organization_id") or "")
    step_index = int(req.get("step_index") or 0)
    step_type = str(req.get("step_type") or "")
    status = str(req.get("status") or "")
    if not run_id or not organization_id or step_index <= 0 or not step_type or not status:
        raise ValueError("agent_runs.record_step missing required fields")

    now = utc_now()
    started_at = req.get("started_at")
    completed_at = req.get("completed_at")

    async with get_db_session() as session:
        row = await session.execute(
            text(
                """
                INSERT INTO agent_run_step (
                    run_id, organization_id, step_index, step_type, status,
                    input_payload, output_payload, evidence_refs,
                    started_at, completed_at, created_at
                ) VALUES (
                    :run_id, :organization_id, :step_index, :step_type, :status,
                    CAST(:input_payload AS JSONB),
                    CAST(:output_payload AS JSONB),
                    CAST(:evidence_refs AS JSONB),
                    :started_at, :completed_at, :created_at
                )
                ON CONFLICT (run_id, step_index)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    input_payload = EXCLUDED.input_payload,
                    output_payload = EXCLUDED.output_payload,
                    evidence_refs = EXCLUDED.evidence_refs,
                    started_at = COALESCE(agent_run_step.started_at, EXCLUDED.started_at),
                    completed_at = EXCLUDED.completed_at
                RETURNING id::text
                """
            ),
            {
                "run_id": run_id,
                "organization_id": organization_id,
                "step_index": step_index,
                "step_type": step_type,
                "status": status,
                "input_payload": json_dumps_canonical(req.get("input_payload") or {}),
                "output_payload": json_dumps_canonical(req.get("output_payload") or {}),
                "evidence_refs": json_dumps_canonical(req.get("evidence_refs") or {}),
                "started_at": started_at,
                "completed_at": completed_at,
                "created_at": now,
            },
        )
        await session.commit()
        result = row.fetchone()
    return str(result.id) if result else ""


@activity.defn(name="agent_runs.acquire_lane")
async def acquire_lane(req: dict[str, Any]) -> bool:
    lane_key = str(req.get("lane_key") or "")
    token = str(req.get("token") or "")
    ttl_seconds = int(req.get("ttl_seconds") or 60)
    if not lane_key or not token:
        raise ValueError("agent_runs.acquire_lane requires lane_key and token")

    redis_client = await _get_redis()
    if redis_client is None:
        # Fail-open in environments without Redis (tests/dev fallback).
        return True

    key = f"drovi:agentos:lane:{lane_key}"
    try:
        acquired = await redis_client.set(key, token, nx=True, ex=max(5, ttl_seconds))
        if acquired:
            return True
        current = await redis_client.get(key)
        if current and current.decode("utf-8") == token:
            await redis_client.expire(key, max(5, ttl_seconds))
            return True
        return False
    finally:
        try:
            await redis_client.close()
        except Exception:
            pass


@activity.defn(name="agent_runs.acquire_org_slot")
async def acquire_org_slot(req: dict[str, Any]) -> bool:
    org_lane_key = str(req.get("org_lane_key") or "")
    token = str(req.get("token") or "")
    ttl_seconds = int(req.get("ttl_seconds") or 60)
    max_concurrency = int(req.get("max_concurrency") or 1)
    if not org_lane_key or not token:
        raise ValueError("agent_runs.acquire_org_slot requires org_lane_key and token")
    if max_concurrency <= 0:
        raise ValueError("agent_runs.acquire_org_slot max_concurrency must be > 0")

    redis_client = await _get_redis()
    if redis_client is None:
        # Fail-open for test/dev fallback. Production should always provide Redis.
        return True

    key = f"drovi:agentos:org_slots:{org_lane_key}"
    now = int(time.time())
    expires_at = now + max(5, ttl_seconds)
    script = """
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
    local existing = redis.call('ZSCORE', KEYS[1], ARGV[1])
    if existing then
      redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      return 1
    end
    local count = redis.call('ZCARD', KEYS[1])
    if count < tonumber(ARGV[2]) then
      redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      return 1
    end
    return 0
    """
    try:
        acquired = await redis_client.eval(
            script,
            1,
            key,
            token,
            str(max_concurrency),
            str(now),
            str(expires_at),
            str(max(5, ttl_seconds)),
        )
        return bool(acquired)
    finally:
        try:
            await redis_client.close()
        except Exception:
            pass


@activity.defn(name="agent_runs.release_org_slot")
async def release_org_slot(req: dict[str, Any]) -> None:
    org_lane_key = str(req.get("org_lane_key") or "")
    token = str(req.get("token") or "")
    if not org_lane_key or not token:
        return

    redis_client = await _get_redis()
    if redis_client is None:
        return

    key = f"drovi:agentos:org_slots:{org_lane_key}"
    try:
        await redis_client.zrem(key, token)
    finally:
        try:
            await redis_client.close()
        except Exception:
            pass


@activity.defn(name="agent_runs.release_lane")
async def release_lane(req: dict[str, Any]) -> None:
    lane_key = str(req.get("lane_key") or "")
    token = str(req.get("token") or "")
    if not lane_key or not token:
        return

    redis_client = await _get_redis()
    if redis_client is None:
        return

    key = f"drovi:agentos:lane:{lane_key}"
    script = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
    """
    try:
        await redis_client.eval(script, 1, key, token)
    finally:
        try:
            await redis_client.close()
        except Exception:
            pass


@activity.defn(name="agent_runs.execute_step")
async def execute_step(req: dict[str, Any]) -> dict[str, Any]:
    step_type = str(req.get("step_type") or "")
    run_id = str(req.get("run_id") or "")
    organization_id = str(req.get("organization_id") or "")
    deployment_id = str(req.get("deployment_id") or "") or None
    payload = req.get("payload") or {}
    if not step_type:
        raise ValueError("agent_runs.execute_step requires step_type")

    tool_id = str(payload.get("tool_id") or "").strip()
    if not tool_id:
        tool_invocations = payload.get("tool_invocations") or []
        if isinstance(tool_invocations, list) and tool_invocations:
            first = tool_invocations[0]
            if isinstance(first, dict):
                tool_id = str(first.get("tool_id") or "").strip()

    evidence_refs = payload.get("evidence_refs") or {}
    approval_request_id: str | None = None
    action_receipt_id: str | None = None
    policy_result_payload: dict[str, Any] | None = None

    if organization_id and tool_id:
        decision = await _policy_engine.decide(
            organization_id=organization_id,
            deployment_id=deployment_id,
            tool_id=tool_id,
            evidence_refs=evidence_refs if isinstance(evidence_refs, dict) else {},
            metadata={"step_type": step_type, "run_id": run_id},
        )
        policy_result_payload = decision.model_dump(mode="json")
        receipt = await _receipt_service.create_receipt(
            organization_id=organization_id,
            run_id=run_id or None,
            deployment_id=deployment_id,
            tool_id=tool_id,
            request_payload={
                "step_type": step_type,
                "payload": payload,
            },
            evidence_refs=evidence_refs if isinstance(evidence_refs, dict) else {},
            policy_result=policy_result_payload,
            final_status="policy_evaluated",
        )
        action_receipt_id = receipt.id

        if decision.action == "deny":
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=receipt.id,
                final_status="denied",
                result_payload={"code": decision.code, "reason": decision.reason},
            )
            raise ApplicationError(
                f"Policy blocked tool execution: {tool_id}",
                type="policy_block",
                non_retryable=True,
            )

        if decision.action == "require_approval":
            approval = await _approval_service.create_request(
                organization_id=organization_id,
                run_id=run_id or None,
                deployment_id=deployment_id,
                tool_id=tool_id,
                action_tier=decision.action_tier,
                reason=decision.reason,
                requested_by=str(payload.get("requested_by")) if payload.get("requested_by") is not None else None,
                sla_minutes=int(payload.get("approval_sla_minutes") or 15),
                escalation_path=payload.get("approval_escalation_path")
                if isinstance(payload.get("approval_escalation_path"), dict)
                else {},
                metadata={"policy_code": decision.code, "step_type": step_type},
            )
            approval_request_id = approval.id
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=receipt.id,
                final_status="waiting_approval",
                approval_request_id=approval_request_id,
                result_payload={"approval_request_id": approval_request_id, "reason": approval.reason},
            )
            return {
                "status": "waiting_approval",
                "message": f"Step requires approval: {step_type}",
                "run_id": run_id,
                "tool_id": tool_id,
                "approval_request_id": approval_request_id,
                "action_receipt_id": action_receipt_id,
                "policy_result": policy_result_payload,
                "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {},
            }

    fail_step = str(payload.get("fail_step") or "")
    if fail_step and fail_step == step_type:
        failure_type = str(payload.get("failure_type") or "transient")
        if failure_type in {"transient", "provider_transient", "tool_transient"}:
            raise ApplicationError(
                f"Transient step failure ({failure_type}) for {step_type}",
                type=failure_type,
            )
        if failure_type in {"policy_block", "validation_error", "permission_denied"}:
            raise ApplicationError(
                f"Non-retryable step failure ({failure_type}) for {step_type}",
                type=failure_type,
                non_retryable=True,
            )
        return {
            "status": "failed",
            "failure_type": failure_type,
            "message": f"Step failed: {step_type}",
            "run_id": run_id,
        }

    approval_step = str(payload.get("approval_step") or "")
    if approval_step and approval_step == step_type:
        if action_receipt_id and organization_id:
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=action_receipt_id,
                final_status="waiting_approval",
                result_payload={"reason": "approval_step_override"},
            )
        return {
            "status": "waiting_approval",
            "message": f"Step requires approval: {step_type}",
            "run_id": run_id,
            "approval_request_id": approval_request_id,
            "action_receipt_id": action_receipt_id,
            "policy_result": policy_result_payload,
            "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {},
        }

    browser_action = _resolve_browser_action(tool_id=tool_id, payload=payload)
    if browser_action and organization_id:
        browser_output = await _execute_browser_step(
            organization_id=organization_id,
            run_id=run_id,
            deployment_id=deployment_id,
            payload=payload,
            action=browser_action,
        )
        result = {
            "status": "completed",
            "run_id": run_id,
            "step_type": step_type,
            "token_usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "tool_usage": [{"tool_id": tool_id or f"browser.{browser_action}", "latency_ms": 0}],
            "output": browser_output,
            "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {"count": 0},
        }
        if action_receipt_id:
            result["action_receipt_id"] = action_receipt_id
            result["policy_result"] = policy_result_payload or {}
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=action_receipt_id,
                final_status="completed",
                approval_request_id=approval_request_id,
                result_payload={"status": "completed", "output": browser_output},
            )
        return result

    desktop_capability = _resolve_desktop_capability(tool_id=tool_id, payload=payload)
    if desktop_capability and organization_id:
        desktop_output = await _execute_desktop_step(
            organization_id=organization_id,
            payload=payload,
            capability=desktop_capability,
        )
        result = {
            "status": "completed",
            "run_id": run_id,
            "step_type": step_type,
            "token_usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "tool_usage": [{"tool_id": tool_id or f"desktop.{desktop_capability}", "latency_ms": 0}],
            "output": desktop_output,
            "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {"count": 0},
        }
        if action_receipt_id:
            result["action_receipt_id"] = action_receipt_id
            result["policy_result"] = policy_result_payload or {}
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=action_receipt_id,
                final_status="completed",
                approval_request_id=approval_request_id,
                result_payload={"status": "completed", "output": desktop_output},
            )
        return result

    work_product_action = _resolve_work_product_action(tool_id=tool_id, payload=payload)
    if work_product_action and organization_id:
        work_product_output = await _execute_work_product_step(
            organization_id=organization_id,
            run_id=run_id,
            payload=payload,
            action=work_product_action,
        )
        work_product_status = str(work_product_output.get("status") or "completed")
        if work_product_status == "pending_approval":
            waiting_result: dict[str, Any] = {
                "status": "waiting_approval",
                "message": f"Work product step requires approval: {step_type}",
                "run_id": run_id,
                "tool_id": tool_id or f"work_product.{work_product_action}",
                "approval_request_id": work_product_output.get("approval_request_id"),
                "policy_result": policy_result_payload or {},
                "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {},
                "output": work_product_output,
            }
            if action_receipt_id:
                waiting_result["action_receipt_id"] = action_receipt_id
                await _receipt_service.finalize_receipt(
                    organization_id=organization_id,
                    receipt_id=action_receipt_id,
                    final_status="waiting_approval",
                    approval_request_id=str(work_product_output.get("approval_request_id") or "") or None,
                    result_payload=work_product_output,
                )
            return waiting_result

        if work_product_status in {"failed", "rolled_back"}:
            if action_receipt_id:
                await _receipt_service.finalize_receipt(
                    organization_id=organization_id,
                    receipt_id=action_receipt_id,
                    final_status="failed",
                    result_payload=work_product_output,
                )
            return {
                "status": "failed",
                "failure_type": "work_product_delivery_failed",
                "message": f"Work product delivery failed ({work_product_status})",
                "run_id": run_id,
                "tool_id": tool_id or f"work_product.{work_product_action}",
                "output": work_product_output,
                "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {},
            }

        result = {
            "status": "completed",
            "run_id": run_id,
            "step_type": step_type,
            "token_usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "tool_usage": [{"tool_id": tool_id or f"work_product.{work_product_action}", "latency_ms": 0}],
            "output": work_product_output,
            "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {"count": 0},
        }
        if action_receipt_id:
            result["action_receipt_id"] = action_receipt_id
            result["policy_result"] = policy_result_payload or {}
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=action_receipt_id,
                final_status="completed",
                approval_request_id=str(work_product_output.get("approval_request_id") or "") or None,
                result_payload=work_product_output,
            )
        return result

    result = {
        "status": "completed",
        "run_id": run_id,
        "step_type": step_type,
        "token_usage": {"prompt_tokens": 120, "completion_tokens": 80},
        "tool_usage": [{"tool_id": step_type, "latency_ms": 42}],
        "output": {
            "summary": f"{step_type} completed",
            "timestamp": _now_iso(),
        },
        "evidence_refs": evidence_refs if isinstance(evidence_refs, dict) else {"count": 0},
    }
    if action_receipt_id:
        result["action_receipt_id"] = action_receipt_id
        result["policy_result"] = policy_result_payload or {}
        if organization_id:
            await _receipt_service.finalize_receipt(
                organization_id=organization_id,
                receipt_id=action_receipt_id,
                final_status="completed",
                approval_request_id=approval_request_id,
                result_payload={"status": "completed", "output": result.get("output") or {}},
            )
    return result


def _resolve_browser_action(*, tool_id: str, payload: dict[str, Any]) -> str | None:
    explicit = str(payload.get("browser_action") or "").strip()
    if explicit in {"navigate", "snapshot", "click", "type", "download", "upload"}:
        return explicit
    if tool_id.startswith("browser."):
        candidate = tool_id.split(".", 1)[1].strip()
        if candidate in {"navigate", "snapshot", "click", "type", "download", "upload"}:
            return candidate
    if tool_id == "browser":
        candidate = str(payload.get("action") or "").strip()
        if candidate in {"navigate", "snapshot", "click", "type", "download", "upload"}:
            return candidate
    return None


def _resolve_desktop_capability(*, tool_id: str, payload: dict[str, Any]) -> str | None:
    explicit = str(payload.get("desktop_capability") or "").strip()
    if explicit:
        return explicit
    if tool_id.startswith("desktop."):
        candidate = tool_id.split(".", 1)[1].strip()
        if candidate:
            return candidate
    if tool_id == "desktop":
        candidate = str(payload.get("capability") or "").strip()
        if candidate:
            return candidate
    return None


def _resolve_work_product_action(*, tool_id: str, payload: dict[str, Any]) -> str | None:
    explicit = str(payload.get("work_product_action") or "").strip()
    if explicit in {"generate", "deliver"}:
        return explicit
    if tool_id.startswith("work_product."):
        candidate = tool_id.split(".", 1)[1].strip()
        if candidate in {"generate", "deliver"}:
            return candidate
    if tool_id == "work_product":
        candidate = str(payload.get("action") or "").strip()
        if candidate in {"generate", "deliver"}:
            return candidate
    return None


async def _execute_browser_step(
    *,
    organization_id: str,
    run_id: str,
    deployment_id: str | None,
    payload: dict[str, Any],
    action: str,
) -> dict[str, Any]:
    session_id = str(payload.get("browser_session_id") or "").strip()
    if not session_id:
        session_request = BrowserCreateSessionRequest(
            organization_id=organization_id,
            provider=payload.get("browser_provider"),
            fallback_providers=payload.get("browser_fallback_providers") or [],
            deployment_id=deployment_id,
            run_id=run_id or None,
            initial_url=payload.get("url"),
            metadata=payload.get("browser_metadata") if isinstance(payload.get("browser_metadata"), dict) else {},
        )
        session = await _browser_service.create_session(request=session_request, actor_id=None)
        session_id = session.id

    browser_request_payload = payload.get("browser_request")
    browser_request_data: dict[str, Any] = (
        dict(browser_request_payload) if isinstance(browser_request_payload, dict) else {}
    )
    browser_request_data.setdefault("organization_id", organization_id)
    browser_request_data.setdefault("action", action)
    for field_name in ("url", "selector", "text", "timeout_ms", "file_name", "content_base64"):
        if field_name not in browser_request_data and payload.get(field_name) is not None:
            browser_request_data[field_name] = payload.get(field_name)
    if "metadata" not in browser_request_data:
        browser_request_data["metadata"] = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}

    browser_request = BrowserActionRequest.model_validate(browser_request_data)
    action_response = await _browser_service.execute_action(
        organization_id=organization_id,
        session_id=session_id,
        request=browser_request,
        actor_id=None,
    )
    return {
        "browser_session_id": action_response.session.id,
        "browser_provider": action_response.session.provider,
        "browser_action_log_id": action_response.action_log.id,
        "browser_action_status": action_response.action_log.status,
        "current_url": action_response.session.current_url,
        "artifacts": action_response.session.artifacts or {},
        "response_payload": action_response.action_log.response_payload,
    }


async def _execute_desktop_step(
    *,
    organization_id: str,
    payload: dict[str, Any],
    capability: str,
) -> dict[str, Any]:
    desktop_request_payload = payload.get("desktop_request")
    desktop_request_data: dict[str, Any] = (
        dict(desktop_request_payload) if isinstance(desktop_request_payload, dict) else {}
    )
    desktop_request_data.setdefault("organization_id", organization_id)
    desktop_request_data.setdefault("capability", capability)
    if "payload" not in desktop_request_data and isinstance(payload.get("payload"), dict):
        desktop_request_data["payload"] = payload.get("payload")
    if "payload" not in desktop_request_data:
        desktop_request_data["payload"] = {}
    for field_name in (
        "bridge_url",
        "bootstrap_secret",
        "token_capabilities",
        "token_ttl_seconds",
        "subject",
        "timeout_seconds",
        "metadata",
    ):
        if field_name not in desktop_request_data and payload.get(field_name) is not None:
            desktop_request_data[field_name] = payload.get(field_name)
    desktop_request = DesktopActionRequest.model_validate(desktop_request_data)
    action_response = await _desktop_service.execute_action(
        request=desktop_request,
        actor_id=None,
    )
    return action_response.model_dump(mode="json")


async def _execute_work_product_step(
    *,
    organization_id: str,
    run_id: str,
    payload: dict[str, Any],
    action: str,
) -> dict[str, Any]:
    actor_id = str(payload.get("requested_by") or "").strip() or None
    if action == "generate":
        request_payload = payload.get("work_product_request")
        request_data: dict[str, Any] = (
            dict(request_payload) if isinstance(request_payload, dict) else {}
        )
        request_data.setdefault("organization_id", organization_id)
        request_data.setdefault("run_id", run_id)
        request_data.setdefault("product_type", payload.get("product_type"))
        if "title" not in request_data and payload.get("title") is not None:
            request_data["title"] = payload.get("title")
        if "instructions" not in request_data and payload.get("instructions") is not None:
            request_data["instructions"] = payload.get("instructions")
        if "input_payload" not in request_data and isinstance(payload.get("input_payload"), dict):
            request_data["input_payload"] = payload.get("input_payload")
        if "evidence_refs" not in request_data and isinstance(payload.get("evidence_refs"), list):
            request_data["evidence_refs"] = payload.get("evidence_refs")
        if "metadata" not in request_data and isinstance(payload.get("metadata"), dict):
            request_data["metadata"] = payload.get("metadata")
        if "require_citations" not in request_data and payload.get("require_citations") is not None:
            request_data["require_citations"] = payload.get("require_citations")

        request = WorkProductGenerateRequest.model_validate(request_data)
        record = await _work_product_service.generate_work_product(
            request=request,
            actor_id=actor_id,
        )
        return {
            "operation": "generate",
            "status": record.status,
            "work_product_id": record.id,
            "work_product": record.model_dump(mode="json"),
        }

    if action == "deliver":
        work_product_id = str(payload.get("work_product_id") or "").strip()
        if not work_product_id:
            raise ValueError("work_product_id is required for work_product.deliver")
        request_payload = payload.get("delivery_request")
        request_data: dict[str, Any] = (
            dict(request_payload) if isinstance(request_payload, dict) else {}
        )
        request_data.setdefault("organization_id", organization_id)
        request_data.setdefault("channel", payload.get("channel"))
        if "approval_tier" not in request_data and payload.get("approval_tier") is not None:
            request_data["approval_tier"] = payload.get("approval_tier")
        if "approved_by" not in request_data and payload.get("approved_by") is not None:
            request_data["approved_by"] = payload.get("approved_by")
        if "subject" not in request_data and payload.get("subject") is not None:
            request_data["subject"] = payload.get("subject")
        if "reply_to" not in request_data and payload.get("reply_to") is not None:
            request_data["reply_to"] = payload.get("reply_to")
        if "endpoint" not in request_data and payload.get("endpoint") is not None:
            request_data["endpoint"] = payload.get("endpoint")
        if "method" not in request_data and payload.get("method") is not None:
            request_data["method"] = payload.get("method")
        if "headers" not in request_data and isinstance(payload.get("headers"), dict):
            request_data["headers"] = payload.get("headers")
        if "body" not in request_data and isinstance(payload.get("body"), dict):
            request_data["body"] = payload.get("body")
        if "metadata" not in request_data and isinstance(payload.get("metadata"), dict):
            request_data["metadata"] = payload.get("metadata")
        if "rollback_on_failure" not in request_data and payload.get("rollback_on_failure") is not None:
            request_data["rollback_on_failure"] = payload.get("rollback_on_failure")
        if "recipients" not in request_data and isinstance(payload.get("recipients"), list):
            request_data["recipients"] = payload.get("recipients")

        request = WorkProductDeliveryRequest.model_validate(request_data)
        result = await _work_product_service.deliver_work_product(
            work_product_id=work_product_id,
            request=request,
            actor_id=actor_id,
        )
        return {
            "operation": "deliver",
            "status": result.status,
            "work_product_id": work_product_id,
            "approval_request_id": result.approval_request_id,
            "delivery": result.model_dump(mode="json"),
        }

    raise ValueError(f"Unsupported work product action: {action}")


@activity.defn(name="agent_runs.compensate")
async def compensate_run(req: dict[str, Any]) -> dict[str, Any]:
    run_id = str(req.get("run_id") or "")
    completed_steps = list(req.get("completed_steps") or [])
    compensation_log = [{"step_type": step.get("step_type"), "status": "compensated"} for step in completed_steps]
    return {
        "run_id": run_id,
        "compensated_steps": compensation_log,
    }


@activity.defn(name="agent_runs.enqueue_dead_letter")
async def enqueue_dead_letter(req: dict[str, Any]) -> str:
    organization_id = str(req.get("organization_id") or "")
    run_id = str(req.get("run_id") or "")
    reason = str(req.get("reason") or "unknown")
    payload = {
        "run_id": run_id,
        "reason": reason,
        "metadata": req.get("metadata") or {},
    }
    return await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="agent.run.dead_letter",
            payload=payload,
            priority=100,
            idempotency_key=f"agent-run-dlq:{run_id}:{reason}",
            resource_key=f"agent-run-dlq:{run_id}",
        )
    )


@activity.defn(name="agent_runs.emit_event")
async def emit_run_event(req: dict[str, Any]) -> None:
    organization_id = str(req.get("organization_id") or "")
    event_type = str(req.get("event_type") or "")
    run_id = str(req.get("run_id") or "")
    if not organization_id or not event_type or not run_id:
        return

    payload = {
        "event_type": event_type,
        "organization_id": organization_id,
        "run_id": run_id,
        "timestamp": _now_iso(),
        "payload": req.get("payload") or {},
    }

    redis_client = await _get_redis()
    if redis_client is None:
        logger.info("agent_run_event", **payload)
        return

    channel = f"drovi:agent_runs:{organization_id}"
    try:
        await redis_client.publish(channel, json.dumps(payload))
    finally:
        try:
            await redis_client.close()
        except Exception:
            pass
