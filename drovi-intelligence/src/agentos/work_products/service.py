from __future__ import annotations

import time
from typing import Any

import httpx
from sqlalchemy import text

from src.agentos.control_plane import ApprovalService
from src.db.client import get_db_session
from src.evidence.register import register_evidence_artifact
from src.evidence.storage import get_evidence_storage
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now
from src.monitoring import get_metrics
from src.notifications.resend import send_resend_email

from .models import (
    RenderedWorkProduct,
    WorkProductArtifactRef,
    WorkProductDeliveryRequest,
    WorkProductDeliveryResult,
    WorkProductGenerateRequest,
    WorkProductRecord,
)
from .renderers import render_work_product
from .verification import verify_work_product


def _parse_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


class WorkProductService:
    def __init__(self) -> None:
        self._approval_service = ApprovalService()
        self._metrics = get_metrics()

    async def list_work_products(
        self,
        *,
        organization_id: str,
        run_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[WorkProductRecord]:
        query = """
            SELECT id, organization_id, run_id, product_type, title, status,
                   artifact_ref, payload, created_at, updated_at
            FROM agent_work_product
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if run_id:
            query += " AND run_id = :run_id"
            params["run_id"] = run_id
        query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()

        return [self._row_to_model(row) for row in rows]

    async def get_work_product(self, *, organization_id: str, work_product_id: str) -> WorkProductRecord | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, product_type, title, status,
                           artifact_ref, payload, created_at, updated_at
                    FROM agent_work_product
                    WHERE organization_id = :organization_id
                      AND id = :id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "id": work_product_id,
                },
            )
            row = result.fetchone()
        if row is None:
            return None
        return self._row_to_model(row)

    async def generate_work_product(
        self,
        *,
        request: WorkProductGenerateRequest,
        actor_id: str | None,
    ) -> WorkProductRecord:
        started_at = time.perf_counter()
        metric_status = "success"
        try:
            await self._assert_run_exists(
                organization_id=request.organization_id,
                run_id=request.run_id,
            )

            rendered = render_work_product(request)
            verification = verify_work_product(request=request, rendered=rendered)
            if not verification.valid:
                raise ValueError(f"Work product verification failed: {', '.join(verification.issues)}")

            work_product_id = new_prefixed_id("agwp")
            artifact = await self._store_artifact(
                organization_id=request.organization_id,
                work_product_id=work_product_id,
                rendered=rendered,
                actor_id=actor_id,
            )

            now = utc_now()
            payload = {
                "instructions": request.instructions,
                "input": request.input_payload,
                "evidence_refs": request.evidence_refs,
                "require_citations": request.require_citations,
                "metadata": request.metadata,
                "rendered": rendered.output_payload,
                "verification": verification.model_dump(mode="json"),
                "artifact": artifact.model_dump(mode="json"),
            }

            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_work_product (
                            id,
                            organization_id,
                            run_id,
                            product_type,
                            title,
                            status,
                            artifact_ref,
                            payload,
                            created_at,
                            updated_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :run_id,
                            :product_type,
                            :title,
                            'generated',
                            :artifact_ref,
                            CAST(:payload AS JSONB),
                            :created_at,
                            :updated_at
                        )
                        """
                    ),
                    {
                        "id": work_product_id,
                        "organization_id": request.organization_id,
                        "run_id": request.run_id,
                        "product_type": request.product_type,
                        "title": rendered.title,
                        "artifact_ref": artifact.artifact_id,
                        "payload": json_dumps_canonical(payload),
                        "created_at": now,
                        "updated_at": now,
                    },
                )
                await session.commit()

            created = await self.get_work_product(
                organization_id=request.organization_id,
                work_product_id=work_product_id,
            )
            if created is None:
                raise RuntimeError("Failed to load generated work product")
            return created
        except Exception:
            metric_status = "error"
            raise
        finally:
            self._metrics.track_agent_work_product_generation(
                product_type=request.product_type,
                status=metric_status,
                duration_seconds=time.perf_counter() - started_at,
            )

    async def deliver_work_product(
        self,
        *,
        work_product_id: str,
        request: WorkProductDeliveryRequest,
        actor_id: str | None,
    ) -> WorkProductDeliveryResult:
        started_at = time.perf_counter()
        final_status = "failed"
        work_product = await self.get_work_product(
            organization_id=request.organization_id,
            work_product_id=work_product_id,
        )
        if work_product is None:
            raise ValueError("Work product not found")

        needs_approval = request.approval_tier in {"high", "critical"} and not request.approved_by
        if needs_approval:
            approval = await self._approval_service.create_request(
                organization_id=request.organization_id,
                run_id=work_product.run_id,
                tool_id=f"work_product.{request.channel}",
                action_tier="external_commit",
                reason=f"Delivery requires approval ({request.approval_tier})",
                requested_by=actor_id,
                metadata={
                    "work_product_id": work_product.id,
                    "delivery_channel": request.channel,
                },
            )
            updated_payload = {
                **work_product.payload,
                "delivery": {
                    "status": "pending_approval",
                    "approval_request_id": approval.id,
                    "channel": request.channel,
                },
            }
            await self._update_work_product(
                work_product=work_product,
                status="pending_approval",
                payload=updated_payload,
            )
            result = WorkProductDeliveryResult(
                work_product_id=work_product.id,
                status="pending_approval",
                delivery_channel=request.channel,
                approval_request_id=approval.id,
                details={"reason": "approval required"},
            )
            final_status = result.status
            return result

        try:
            details = await self._deliver(
                work_product=work_product,
                request=request,
            )
            delivered_at = utc_now()
            updated_payload = {
                **work_product.payload,
                "delivery": {
                    "status": "delivered",
                    "channel": request.channel,
                    "delivered_at": delivered_at.isoformat(),
                    "details": details,
                    "metadata": request.metadata,
                },
            }
            await self._update_work_product(
                work_product=work_product,
                status="delivered",
                payload=updated_payload,
            )
            result = WorkProductDeliveryResult(
                work_product_id=work_product.id,
                status="delivered",
                delivery_channel=request.channel,
                delivered_at=delivered_at,
                details=details,
            )
            final_status = result.status
            return result
        except Exception as exc:
            error_text = str(exc)
            if request.rollback_on_failure:
                rolled_payload = {
                    **work_product.payload,
                    "delivery": {
                        "status": "rolled_back",
                        "channel": request.channel,
                        "error": error_text,
                        "rolled_back_at": utc_now().isoformat(),
                    },
                }
                await self._update_work_product(
                    work_product=work_product,
                    status="rolled_back",
                    payload=rolled_payload,
                )
                result = WorkProductDeliveryResult(
                    work_product_id=work_product.id,
                    status="rolled_back",
                    delivery_channel=request.channel,
                    details={"error": error_text},
                )
                final_status = result.status
                return result

            failed_payload = {
                **work_product.payload,
                "delivery": {
                    "status": "failed",
                    "channel": request.channel,
                    "error": error_text,
                    "failed_at": utc_now().isoformat(),
                },
            }
            await self._update_work_product(
                work_product=work_product,
                status="failed",
                payload=failed_payload,
            )
            result = WorkProductDeliveryResult(
                work_product_id=work_product.id,
                status="failed",
                delivery_channel=request.channel,
                details={"error": error_text},
            )
            final_status = result.status
            return result
        finally:
            self._metrics.track_agent_work_product_delivery(
                channel=request.channel,
                status=final_status,
                duration_seconds=time.perf_counter() - started_at,
            )

    async def _store_artifact(
        self,
        *,
        organization_id: str,
        work_product_id: str,
        rendered: RenderedWorkProduct,
        actor_id: str | None,
    ) -> WorkProductArtifactRef:
        artifact_id = new_prefixed_id("evh")
        storage = get_evidence_storage()
        stored = await storage.write_bytes(
            artifact_id=artifact_id,
            data=rendered.content_bytes,
            extension=rendered.extension,
            organization_id=organization_id,
        )

        await register_evidence_artifact(
            organization_id=organization_id,
            artifact_id=artifact_id,
            artifact_type=f"agent_work_product_{rendered.product_type}",
            mime_type=rendered.mime_type,
            storage_backend=stored.storage_backend,
            storage_path=stored.storage_path,
            byte_size=stored.byte_size,
            sha256=stored.sha256,
            metadata={
                "work_product_id": work_product_id,
                "title": rendered.title,
            },
            source_type="agent_work_product",
            source_id=work_product_id,
            actor_type="user" if actor_id else "system",
            actor_id=actor_id,
        )
        return WorkProductArtifactRef(
            artifact_id=artifact_id,
            storage_backend=stored.storage_backend,
            storage_path=stored.storage_path,
            byte_size=stored.byte_size,
            sha256=stored.sha256,
        )

    async def _update_work_product(
        self,
        *,
        work_product: WorkProductRecord,
        status: str,
        payload: dict[str, Any],
    ) -> None:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_work_product
                    SET status = :status,
                        payload = CAST(:payload AS JSONB),
                        updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND id = :id
                    """
                ),
                {
                    "status": status,
                    "payload": json_dumps_canonical(payload),
                    "updated_at": utc_now(),
                    "organization_id": work_product.organization_id,
                    "id": work_product.id,
                },
            )
            await session.commit()

    async def _deliver(
        self,
        *,
        work_product: WorkProductRecord,
        request: WorkProductDeliveryRequest,
    ) -> dict[str, Any]:
        if request.channel == "email":
            return await self._deliver_email(work_product=work_product, request=request)
        if request.channel == "share_link":
            return await self._deliver_share_link(work_product=work_product)
        if request.channel in {"crm_attachment", "project_ticket", "api_action"}:
            return await self._deliver_webhook(work_product=work_product, request=request)
        raise ValueError(f"Unsupported delivery channel: {request.channel}")

    async def _deliver_email(
        self,
        *,
        work_product: WorkProductRecord,
        request: WorkProductDeliveryRequest,
    ) -> dict[str, Any]:
        rendered_payload = work_product.payload.get("rendered") if isinstance(work_product.payload, dict) else {}
        recipients = request.recipients
        if not recipients:
            from_payload = rendered_payload.get("recipients") if isinstance(rendered_payload, dict) else None
            if isinstance(from_payload, list):
                recipients = [str(item) for item in from_payload if str(item)]
        if not recipients:
            raise ValueError("No email recipients provided")

        subject = request.subject or str(rendered_payload.get("subject") or work_product.title or "Drovi work product")
        html_body = str(rendered_payload.get("html") or "")
        text_body = str(rendered_payload.get("text") or work_product.payload.get("rendered", {}).get("summary") or "")
        if not html_body and work_product.artifact_ref:
            html_body = await self._load_artifact_text(
                artifact_id=work_product.artifact_ref,
                organization_id=work_product.organization_id,
            )
        if not text_body:
            text_body = html_body

        success = await send_resend_email(
            to_emails=recipients,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            tags={"work_product_id": work_product.id, "channel": "email"},
        )
        if not success:
            raise RuntimeError("Resend email delivery failed")

        return {
            "recipient_count": len(recipients),
            "subject": subject,
        }

    async def _deliver_share_link(self, *, work_product: WorkProductRecord) -> dict[str, Any]:
        if not work_product.artifact_ref:
            raise ValueError("Work product has no artifact")

        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT storage_path
                    FROM evidence_artifact
                    WHERE id = :artifact_id
                      AND organization_id = :organization_id
                    """
                ),
                {
                    "artifact_id": work_product.artifact_ref,
                    "organization_id": work_product.organization_id,
                },
            )
            row = result.fetchone()
        if row is None:
            raise ValueError("Artifact reference not found")

        storage_path = str(row.storage_path)
        url = await get_evidence_storage().create_presigned_url(storage_path)
        if not url:
            url = (
                f"/api/v1/evidence/artifacts/{work_product.artifact_ref}"
                f"?organization_id={work_product.organization_id}"
            )

        return {
            "artifact_id": work_product.artifact_ref,
            "url": url,
        }

    async def _deliver_webhook(
        self,
        *,
        work_product: WorkProductRecord,
        request: WorkProductDeliveryRequest,
    ) -> dict[str, Any]:
        body = request.body or {
            "work_product_id": work_product.id,
            "organization_id": work_product.organization_id,
            "run_id": work_product.run_id,
            "product_type": work_product.product_type,
            "title": work_product.title,
            "artifact_ref": work_product.artifact_ref,
            "payload": work_product.payload,
            "channel": request.channel,
        }

        if not request.endpoint:
            if request.channel == "project_ticket":
                return {
                    "ticket_id": new_prefixed_id("agtkt"),
                    "simulated": True,
                }
            if request.channel == "crm_attachment":
                return {
                    "attachment_id": new_prefixed_id("agatt"),
                    "simulated": True,
                }
            raise ValueError("endpoint is required for api_action delivery")

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                request.method,
                request.endpoint,
                headers=request.headers,
                json=body,
            )

        if response.status_code >= 400:
            raise RuntimeError(
                f"Delivery endpoint failed with status {response.status_code}: {response.text[:200]}"
            )

        return {
            "endpoint": request.endpoint,
            "status_code": response.status_code,
            "response": _response_payload(response),
        }

    async def _load_artifact_text(self, *, artifact_id: str, organization_id: str) -> str:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT storage_path
                    FROM evidence_artifact
                    WHERE id = :artifact_id
                      AND organization_id = :organization_id
                    """
                ),
                {"artifact_id": artifact_id, "organization_id": organization_id},
            )
            row = result.fetchone()
        if row is None:
            return ""
        data = await get_evidence_storage().read_bytes(str(row.storage_path))
        try:
            return data.decode("utf-8")
        except Exception:
            return ""

    async def _assert_run_exists(self, *, organization_id: str, run_id: str) -> None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_run
                    WHERE id = :run_id
                      AND organization_id = :organization_id
                    """
                ),
                {
                    "run_id": run_id,
                    "organization_id": organization_id,
                },
            )
            row = result.fetchone()
        if row is None:
            raise ValueError("Run not found for work product generation")

    def _row_to_model(self, row: Any) -> WorkProductRecord:
        mapping = row._mapping if hasattr(row, "_mapping") else row
        return WorkProductRecord.model_validate(
            {
                "id": str(mapping["id"]),
                "organization_id": str(mapping["organization_id"]),
                "run_id": mapping.get("run_id"),
                "product_type": mapping["product_type"],
                "title": mapping.get("title"),
                "status": mapping["status"],
                "artifact_ref": mapping.get("artifact_ref"),
                "payload": _parse_payload(mapping.get("payload")),
                "created_at": mapping.get("created_at"),
                "updated_at": mapping.get("updated_at"),
            }
        )


def _response_payload(response: httpx.Response) -> Any:
    content_type = str(response.headers.get("content-type") or "")
    if content_type.startswith("application/json"):
        try:
            return response.json()
        except Exception:
            return response.text
    return response.text
