"""World crawl fabric execution pipeline."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog

from src.config import get_settings
from src.crawlers.diff.semantic import compute_semantic_diff
from src.crawlers.fetch.render_worker import fetch_rendered
from src.crawlers.fetch.static_worker import fetch_static
from src.crawlers.frontier.scheduler import CrawlFrontierScheduler
from src.crawlers.parse.templates import parse_payload
from src.crawlers.policy import evaluate_crawl_policy
from src.crawlers.repository import (
    FrontierSeedRequest,
    create_crawl_snapshot,
    get_frontier_entry,
    get_latest_snapshot_for_entry,
    get_snapshot,
    mark_frontier_blocked,
    mark_frontier_fetch_failed,
    mark_frontier_fetch_succeeded,
    normalize_url,
    update_snapshot_diff,
    update_snapshot_parse,
    upsert_frontier_seed,
    write_audit_log,
)
from src.ingestion.raw_capture import register_existing_raw_observation_artifact
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.lakehouse.writer import write_lake_record

logger = structlog.get_logger()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _snapshot_file_path(*, organization_id: str, snapshot_id: str) -> Path:
    settings = get_settings()
    root = Path(settings.evidence_storage_path).expanduser()
    return root / "crawl" / organization_id / f"{snapshot_id}.bin"


def _write_snapshot_payload(*, organization_id: str, snapshot_id: str, payload: bytes) -> str:
    path = _snapshot_file_path(organization_id=organization_id, snapshot_id=snapshot_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return str(path)


def _read_snapshot_payload(*, organization_id: str, snapshot_id: str) -> bytes:
    path = _snapshot_file_path(organization_id=organization_id, snapshot_id=snapshot_id)
    if not path.exists():
        return b""
    return path.read_bytes()


def _payload_preview(payload: bytes, *, limit: int = 5000) -> str:
    if not payload:
        return ""
    return payload[:limit].decode("utf-8", errors="replace")


async def _maybe_publish_stage_event(
    *,
    topic: str,
    organization_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    settings = get_settings()
    if not settings.kafka_enabled:
        return
    from src.streaming.kafka_producer import get_kafka_producer

    producer = await get_kafka_producer()
    await producer.produce(
        topic=topic,
        key=f"{organization_id}:{event_type}:{payload.get('id') or uuid4()}",
        value={
            "organization_id": organization_id,
            "event_type": event_type,
            "occurred_at": _utc_now().isoformat(),
            "payload": payload,
        },
        headers={
            "organization_id": organization_id,
            "event_type": event_type,
        },
    )


async def create_frontier_seed(
    *,
    organization_id: str,
    source_key: str,
    url: str,
    seed_type: str = "manual",
    priority: int = 0,
    freshness_policy_minutes: int = 60,
    metadata: dict[str, Any] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    row = await upsert_frontier_seed(
        FrontierSeedRequest(
            organization_id=organization_id,
            source_key=source_key,
            url=url,
            seed_type=seed_type,
            priority=priority,
            freshness_policy_minutes=freshness_policy_minutes,
            metadata=metadata or {},
        )
    )

    await write_audit_log(
        organization_id=organization_id,
        frontier_entry_id=row.get("id"),
        event_type="crawl.frontier.seeded",
        actor=actor,
        decision="queued",
        metadata={
            "url": row.get("url"),
            "domain": row.get("domain"),
            "source_key": source_key,
            **(metadata or {}),
        },
    )
    await _maybe_publish_stage_event(
        topic=get_settings().kafka_topic_crawl_frontier,
        organization_id=organization_id,
        event_type="crawl.frontier.seeded",
        payload={"id": row.get("id"), "url": row.get("url"), "source_key": source_key},
    )
    return row


async def run_crawl_frontier_tick(
    *,
    sync_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    scheduler = CrawlFrontierScheduler(
        dispatch_limit=int(settings.crawl_frontier_dispatch_limit),
        per_domain_limit=int(settings.crawl_domain_concurrency_limit),
        idempotency_bucket_seconds=int(settings.crawl_idempotency_bucket_seconds),
    )
    dispatches = await scheduler.claim_dispatches()
    job_ids = await scheduler.enqueue_fetch_jobs(dispatches, sync_params=sync_params)

    await _maybe_publish_stage_event(
        topic=settings.kafka_topic_crawl_frontier,
        organization_id="internal",
        event_type="crawl.frontier.tick.completed",
        payload={
            "id": str(uuid4()),
            "claimed": len(dispatches),
            "enqueued": len(job_ids),
        },
    )

    return {
        "claimed": len(dispatches),
        "enqueued": len(job_ids),
        "job_ids": job_ids,
    }


def _should_render(entry: dict[str, Any], sync_params: dict[str, Any]) -> bool:
    if bool(sync_params.get("force_render")):
        return True
    metadata = entry.get("metadata")
    if isinstance(metadata, dict) and metadata.get("requires_js"):
        return True
    return False


async def run_crawl_fetch_stage(
    *,
    frontier_entry_id: str,
    sync_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    sync_params = sync_params or {}
    entry = await get_frontier_entry(frontier_entry_id)
    if not entry:
        raise ValueError(f"Crawl frontier entry not found: {frontier_entry_id}")

    organization_id = str(entry["organization_id"])
    url = str(entry["url"])
    policy = await evaluate_crawl_policy(
        organization_id=organization_id,
        url=url,
    )
    if not policy.allowed:
        await mark_frontier_blocked(
            entry_id=frontier_entry_id,
            policy_state=policy.policy_state,
            reason=policy.reason,
        )
        await write_audit_log(
            organization_id=organization_id,
            frontier_entry_id=frontier_entry_id,
            event_type="crawl.fetch.blocked",
            severity="warning",
            decision="blocked",
            reason=policy.reason,
            metadata={"policy_state": policy.policy_state, "rule_id": policy.matched_rule_id},
        )
        return {"status": "blocked", "policy_state": policy.policy_state}

    use_render = _should_render(entry, sync_params)
    if use_render:
        render_result = await fetch_rendered(
            url=url,
            user_agent=settings.crawl_user_agent,
            timeout_ms=int(settings.crawl_render_timeout_ms),
        )
        body = (render_result.html or "").encode("utf-8", errors="replace")
        status_code = int(render_result.status_code)
        content_type = render_result.content_type or "text/html"
        retryable = bool(render_result.retryable)
        error_message = render_result.error_message
        final_url = render_result.final_url
        blocked = bool(render_result.blocked)
    else:
        static_result = await fetch_static(
            url=url,
            timeout_seconds=float(settings.crawl_fetch_timeout_seconds),
            user_agent=settings.crawl_user_agent,
            max_attempts=int(settings.crawl_fetch_max_attempts),
            proxy_url=settings.crawl_proxy_url,
        )
        body = static_result.content
        status_code = int(static_result.status_code)
        content_type = static_result.content_type
        retryable = bool(static_result.retryable)
        error_message = static_result.error_message
        final_url = static_result.final_url
        blocked = bool(static_result.blocked)

    if status_code <= 0 or status_code >= 400:
        delay = 120 if retryable else 30 * max(1, int(entry.get("failure_count") or 0) + 1)
        if blocked:
            delay = max(delay, 300)
        await mark_frontier_fetch_failed(
            entry_id=frontier_entry_id,
            error_message=error_message or f"HTTP {status_code}",
            http_status=status_code if status_code > 0 else None,
            retry_delay_seconds=delay,
        )
        await write_audit_log(
            organization_id=organization_id,
            frontier_entry_id=frontier_entry_id,
            event_type="crawl.fetch.failed",
            severity="warning",
            decision="retry" if retryable else "failed_terminal",
            reason=error_message or f"HTTP {status_code}",
            metadata={"status_code": status_code, "retryable": retryable, "blocked": blocked},
        )
        await _maybe_publish_stage_event(
            topic=settings.kafka_topic_crawl_fetch,
            organization_id=organization_id,
            event_type="crawl.fetch.failed",
            payload={
                "id": frontier_entry_id,
                "status_code": status_code,
                "retryable": retryable,
                "blocked": blocked,
            },
        )
        return {"status": "failed", "status_code": status_code, "retryable": retryable}

    payload_hash = hashlib.sha256(body).hexdigest()
    snapshot_id = str(uuid4())
    storage_ref = _write_snapshot_payload(
        organization_id=organization_id,
        snapshot_id=snapshot_id,
        payload=body,
    )
    created_snapshot_id = await create_crawl_snapshot(
        snapshot_id=snapshot_id,
        organization_id=organization_id,
        frontier_entry_id=frontier_entry_id,
        url=normalize_url(final_url),
        content_type=content_type,
        http_status=status_code,
        rendered=use_render,
        payload_hash=payload_hash,
        payload_size_bytes=len(body),
        storage_ref=storage_ref,
    )
    snapshot_id = created_snapshot_id

    artifact = await register_existing_raw_observation_artifact(
        organization_id=organization_id,
        source_type="crawler",
        source_id=snapshot_id,
        storage_path=storage_ref,
        payload_sha256=payload_hash,
        payload_size_bytes=len(body),
        artifact_id=f"crawl-raw-{snapshot_id}",
        observed_at=_utc_now(),
        metadata={
            "frontier_entry_id": frontier_entry_id,
            "source_key": str(entry.get("source_key") or "crawler"),
            "url": normalize_url(final_url),
            "content_type": content_type,
            "http_status": status_code,
            "rendered": use_render,
        },
        immutable=True,
        legal_hold=policy.policy_state == "legal_hold",
    )

    if settings.kafka_enabled:
        from src.streaming.kafka_producer import get_kafka_producer

        producer = await get_kafka_producer()
        trace_material = f"crawl:{organization_id}:{snapshot_id}:{payload_hash}"
        trace_id = hashlib.sha256(trace_material.encode("utf-8")).hexdigest()[:32]
        await producer.produce_observation_raw_event(
            organization_id=organization_id,
            source_type="crawler",
            observation_type="crawl.snapshot",
            content={
                "snapshot_id": snapshot_id,
                "frontier_entry_id": frontier_entry_id,
                "source_key": str(entry.get("source_key") or "crawler"),
                "url": normalize_url(final_url),
                "content_type": content_type,
                "http_status": status_code,
                "payload_hash": payload_hash,
                "storage_ref": storage_ref,
                "rendered": use_render,
                "payload_preview": _payload_preview(body),
            },
            source_ref=snapshot_id,
            tags=["crawler", "fetch", str(entry.get("source_key") or "crawler")],
            source_metadata={
                "frontier_entry_id": frontier_entry_id,
                "source_key": str(entry.get("source_key") or "crawler"),
                "status_code": status_code,
                "content_type": content_type,
                "rendered": use_render,
            },
            ingest_run_id=str(sync_params.get("source_sync_run_id") or ""),
            trace_id=trace_id,
            deterministic_key=trace_material,
            persist_raw_payload=False,
            artifact_id=artifact.artifact_id,
            artifact_sha256=artifact.sha256,
            artifact_storage_path=artifact.storage_path,
            artifact_size_bytes=artifact.byte_size,
            legal_hold=policy.policy_state == "legal_hold",
        )

    try:
        await write_lake_record(
            table_name="bronze.raw_observations",
            schema_version="1.0",
            organization_id=organization_id,
            source_key=str(entry.get("source_key") or "crawler"),
            record_key=f"crawl_snapshot:{snapshot_id}",
            event_time=_utc_now(),
            payload={
                "record_key": f"crawl_snapshot:{snapshot_id}",
                "organization_id": organization_id,
                "source_key": str(entry.get("source_key") or "crawler"),
                "event_time": _utc_now().isoformat(),
                "payload": {
                    "frontier_entry_id": frontier_entry_id,
                    "snapshot_id": snapshot_id,
                    "url": normalize_url(final_url),
                    "content_type": content_type,
                    "status_code": status_code,
                    "storage_ref": storage_ref,
                    "rendered": use_render,
                    "payload_hash": payload_hash,
                },
                "metadata": {"pipeline_stage": "crawl.fetch"},
            },
            idempotency_key=f"crawl_fetch:{snapshot_id}",
            metadata={"frontier_entry_id": frontier_entry_id},
        )
    except Exception as exc:  # pragma: no cover - non-blocking path
        logger.warning(
            "Lakehouse bronze write failed for crawl fetch",
            snapshot_id=snapshot_id,
            error=str(exc),
        )

    next_fetch_minutes = int(entry.get("freshness_policy_minutes") or 60)
    await mark_frontier_fetch_succeeded(
        entry_id=frontier_entry_id,
        http_status=status_code,
        next_fetch_in_minutes=next_fetch_minutes,
        metadata_patch={
            "last_payload_hash": payload_hash,
            "last_snapshot_id": snapshot_id,
            "last_content_type": content_type,
            "last_fetch_mode": "rendered" if use_render else "static",
        },
    )

    parse_job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="crawl.parse",
            payload={
                "snapshot_id": snapshot_id,
                "organization_id": organization_id,
                "frontier_entry_id": frontier_entry_id,
            },
            priority=max(0, min(9, int(entry.get("priority") or 0))),
            max_attempts=3,
            idempotency_key=f"crawl_parse:{snapshot_id}",
            resource_key=f"crawl-parse:{frontier_entry_id}",
        )
    )
    await write_audit_log(
        organization_id=organization_id,
        frontier_entry_id=frontier_entry_id,
        snapshot_id=snapshot_id,
        event_type="crawl.fetch.succeeded",
        decision="queued_parse",
        metadata={
            "status_code": status_code,
            "payload_hash": payload_hash,
            "storage_ref": storage_ref,
            "parse_job_id": parse_job_id,
            "rendered": use_render,
        },
    )
    await _maybe_publish_stage_event(
        topic=settings.kafka_topic_crawl_fetch,
        organization_id=organization_id,
        event_type="crawl.fetch.succeeded",
        payload={
            "id": frontier_entry_id,
            "snapshot_id": snapshot_id,
            "status_code": status_code,
            "payload_hash": payload_hash,
            "rendered": use_render,
        },
    )
    return {
        "status": "succeeded",
        "snapshot_id": snapshot_id,
        "parse_job_id": parse_job_id,
        "status_code": status_code,
    }


async def run_crawl_parse_stage(
    *,
    snapshot_id: str,
) -> dict[str, Any]:
    settings = get_settings()
    snapshot = await get_snapshot(snapshot_id)
    if not snapshot:
        raise ValueError(f"Crawl snapshot not found: {snapshot_id}")

    organization_id = str(snapshot["organization_id"])
    frontier_entry_id = str(snapshot["frontier_entry_id"])
    raw_payload = _read_snapshot_payload(
        organization_id=organization_id,
        snapshot_id=snapshot_id,
    )
    parsed = parse_payload(
        url=str(snapshot.get("url") or ""),
        content_type=snapshot.get("content_type"),
        payload=raw_payload,
    )
    await update_snapshot_parse(
        snapshot_id=snapshot_id,
        parsed_text=parsed.text,
        parsed_metadata=parsed.metadata,
    )

    try:
        await write_lake_record(
            table_name="silver.observations",
            schema_version="1.0",
            organization_id=organization_id,
            source_key="crawler_parse",
            record_key=f"crawl_parse:{snapshot_id}",
            event_time=_utc_now(),
            payload={
                "observation_id": snapshot_id,
                "organization_id": organization_id,
                "source_key": "crawler_parse",
                "observed_at": _utc_now().isoformat(),
                "normalized_text": parsed.text,
                "entities": [],
                "evidence_links": [str(snapshot.get("storage_ref") or "")],
                "metadata": {
                    "template_type": parsed.template_type,
                    "frontier_entry_id": frontier_entry_id,
                },
            },
            idempotency_key=f"crawl_parse:{snapshot_id}",
            metadata={"pipeline_stage": "crawl.parse"},
        )
    except Exception as exc:  # pragma: no cover - non-blocking path
        logger.warning(
            "Lakehouse silver write failed for crawl parse",
            snapshot_id=snapshot_id,
            error=str(exc),
        )

    diff_job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="crawl.diff",
            payload={
                "snapshot_id": snapshot_id,
                "organization_id": organization_id,
                "frontier_entry_id": frontier_entry_id,
            },
            priority=1,
            max_attempts=3,
            idempotency_key=f"crawl_diff:{snapshot_id}",
            resource_key=f"crawl-diff:{frontier_entry_id}",
        )
    )

    await write_audit_log(
        organization_id=organization_id,
        frontier_entry_id=frontier_entry_id,
        snapshot_id=snapshot_id,
        event_type="crawl.parse.completed",
        decision="queued_diff",
        metadata={
            "template_type": parsed.template_type,
            "text_length": len(parsed.text),
            "diff_job_id": diff_job_id,
        },
    )
    await _maybe_publish_stage_event(
        topic=settings.kafka_topic_crawl_parse,
        organization_id=organization_id,
        event_type="crawl.parse.completed",
        payload={
            "id": snapshot_id,
            "frontier_entry_id": frontier_entry_id,
            "template_type": parsed.template_type,
            "text_length": len(parsed.text),
        },
    )
    return {
        "status": "succeeded",
        "snapshot_id": snapshot_id,
        "frontier_entry_id": frontier_entry_id,
        "template_type": parsed.template_type,
        "diff_job_id": diff_job_id,
    }


async def run_crawl_diff_stage(
    *,
    snapshot_id: str,
) -> dict[str, Any]:
    settings = get_settings()
    snapshot = await get_snapshot(snapshot_id)
    if not snapshot:
        raise ValueError(f"Crawl snapshot not found: {snapshot_id}")

    organization_id = str(snapshot["organization_id"])
    frontier_entry_id = str(snapshot["frontier_entry_id"])
    current_text = str(snapshot.get("parsed_text") or "")

    previous = await get_latest_snapshot_for_entry(
        frontier_entry_id=frontier_entry_id,
        exclude_snapshot_id=snapshot_id,
    )
    previous_text = str(previous.get("parsed_text") or "") if previous else ""

    diff = compute_semantic_diff(
        previous_text=previous_text,
        current_text=current_text,
        significance_threshold=float(settings.crawl_significance_threshold),
    )
    await update_snapshot_diff(
        snapshot_id=snapshot_id,
        diff_from_snapshot_id=previous.get("id") if previous else None,
        significance_score=diff.significance_score,
        is_meaningful_delta=diff.meaningful,
    )

    emitted_observation_event = False
    if diff.meaningful and current_text:
        if settings.kafka_enabled:
            from src.streaming.kafka_producer import get_kafka_producer

            producer = await get_kafka_producer()
            event_id = str(uuid4())
            await producer.produce_world_brain_event(
                event_type="observation.normalized.v1",
                topic=settings.kafka_topic_normalized_records,
                event={
                    "schema_version": "1.0",
                    "organization_id": organization_id,
                    "event_id": event_id,
                    "occurred_at": _utc_now(),
                    "producer": "drovi-intelligence",
                    "event_type": "observation.normalized.v1",
                    "payload": {
                        "observation_id": snapshot_id,
                        "normalized_text": current_text[:50000],
                        "entities": [],
                        "embedding_ref": None,
                        "confidence": max(0.05, min(1.0, diff.significance_score)),
                        "valid_from": snapshot.get("fetched_at"),
                        "valid_to": None,
                    },
                },
            )
            emitted_observation_event = True

    try:
        await write_lake_record(
            table_name="gold.impact_features",
            schema_version="1.0",
            organization_id=organization_id,
            source_key="crawler_diff",
            record_key=f"crawl_diff:{snapshot_id}",
            event_time=_utc_now(),
            payload={
                "feature_key": f"crawl_diff:{snapshot_id}",
                "organization_id": organization_id,
                "source_key": "crawler_diff",
                "event_time": _utc_now().isoformat(),
                "feature_vector": {
                    "significance_score": diff.significance_score,
                    "jaccard_distance": diff.jaccard_distance,
                    "length_delta_ratio": diff.length_delta_ratio,
                    "meaningful": diff.meaningful,
                    "added_terms_count": len(diff.added_terms),
                    "removed_terms_count": len(diff.removed_terms),
                },
                "labels": {
                    "table": "crawl_snapshot",
                    "frontier_entry_id": frontier_entry_id,
                },
            },
            idempotency_key=f"crawl_diff:{snapshot_id}",
            metadata={"pipeline_stage": "crawl.diff"},
        )
    except Exception as exc:  # pragma: no cover - non-blocking path
        logger.warning(
            "Lakehouse gold write failed for crawl diff",
            snapshot_id=snapshot_id,
            error=str(exc),
        )

    await write_audit_log(
        organization_id=organization_id,
        frontier_entry_id=frontier_entry_id,
        snapshot_id=snapshot_id,
        event_type="crawl.diff.completed",
        decision="emitted_observation" if emitted_observation_event else "suppressed",
        metadata={
            "significance_score": diff.significance_score,
            "meaningful": diff.meaningful,
            "added_terms_count": len(diff.added_terms),
            "removed_terms_count": len(diff.removed_terms),
            "previous_snapshot_id": previous.get("id") if previous else None,
        },
    )
    await _maybe_publish_stage_event(
        topic=settings.kafka_topic_crawl_diff,
        organization_id=organization_id,
        event_type="crawl.diff.completed",
        payload={
            "id": snapshot_id,
            "frontier_entry_id": frontier_entry_id,
            "significance_score": diff.significance_score,
            "meaningful": diff.meaningful,
            "emitted_observation": emitted_observation_event,
        },
    )
    return {
        "status": "succeeded",
        "snapshot_id": snapshot_id,
        "frontier_entry_id": frontier_entry_id,
        "significance_score": diff.significance_score,
        "meaningful": diff.meaningful,
        "emitted_observation": emitted_observation_event,
    }
