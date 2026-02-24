#!/usr/bin/env python3
"""World Brain HPA autoscaler driven by queue and freshness pressure."""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime
import json
import os
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

import asyncpg

from src.ops.world_brain_autoscaler import (
    ANNOTATION_LAST_ACTION,
    ANNOTATION_LAST_REASON,
    ANNOTATION_LAST_SCALE_AT,
    DEFAULT_POOL_HPA_NAMES,
    HPAPoolState,
    aggregate_pool_queue_depths,
    build_scale_decision,
)


def _normalize_database_url(raw: str) -> str:
    if "+asyncpg" not in raw:
        return raw
    parts = urlsplit(raw)
    return urlunsplit((parts.scheme.replace("+asyncpg", ""), parts.netloc, parts.path, parts.query, parts.fragment))


def _parse_bool(raw: str | None, *, default: bool) -> bool:
    if raw is None:
        return default
    normalized = str(raw).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _load_pool_hpa_map(raw: str | None) -> dict[str, str]:
    if not raw:
        return dict(DEFAULT_POOL_HPA_NAMES)
    try:
        parsed = json.loads(raw)
    except Exception:
        return dict(DEFAULT_POOL_HPA_NAMES)
    if not isinstance(parsed, dict):
        return dict(DEFAULT_POOL_HPA_NAMES)
    out: dict[str, str] = {}
    for pool, value in parsed.items():
        pool_name = str(pool).strip()
        hpa_name = str(value).strip()
        if pool_name and hpa_name:
            out[pool_name] = hpa_name
    return out or dict(DEFAULT_POOL_HPA_NAMES)


class InClusterKubernetesClient:
    def __init__(self, *, namespace: str) -> None:
        host = os.getenv("KUBERNETES_SERVICE_HOST")
        port = os.getenv("KUBERNETES_SERVICE_PORT") or "443"
        if not host:
            raise RuntimeError("Missing KUBERNETES_SERVICE_HOST; expected in-cluster execution.")
        self._base_url = f"https://{host}:{port}"
        self._namespace = namespace
        token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        ca_path = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        with open(token_path, encoding="utf-8") as handle:
            self._token = handle.read().strip()
        self._ssl_ctx = ssl.create_default_context(cafile=ca_path)

    def _request(
        self,
        *,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        data = None if payload is None else json.dumps(payload, ensure_ascii=True).encode("utf-8")
        req = Request(url=url, data=data, method=method.upper())
        req.add_header("Authorization", f"Bearer {self._token}")
        req.add_header("Accept", "application/json")
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with urlopen(req, context=self._ssl_ctx, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
        except HTTPError as exc:
            message = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Kubernetes API error {exc.code} for {path}: {message}") from exc
        except URLError as exc:
            raise RuntimeError(f"Kubernetes API request failed for {path}: {exc}") from exc

        if not raw:
            return {}
        try:
            return dict(json.loads(raw))
        except Exception as exc:
            raise RuntimeError(f"Invalid JSON response from Kubernetes API for {path}") from exc

    def get_hpa(self, *, hpa_name: str) -> dict[str, Any]:
        path = f"/apis/autoscaling/v2/namespaces/{self._namespace}/horizontalpodautoscalers/{hpa_name}"
        return self._request(method="GET", path=path)

    def patch_hpa_min_replicas(
        self,
        *,
        hpa_name: str,
        min_replicas: int,
        action: str,
        reason: str,
        now: datetime,
    ) -> dict[str, Any]:
        path = f"/apis/autoscaling/v2/namespaces/{self._namespace}/horizontalpodautoscalers/{hpa_name}"
        payload = {
            "metadata": {
                "annotations": {
                    ANNOTATION_LAST_SCALE_AT: now.isoformat(),
                    ANNOTATION_LAST_ACTION: action,
                    ANNOTATION_LAST_REASON: reason,
                }
            },
            "spec": {
                "minReplicas": int(max(1, min_replicas)),
            },
        }
        return self._request(
            method="PATCH",
            path=path,
            payload=payload,
            content_type="application/merge-patch+json",
        )


async def _fetch_job_queue_counts(*, database_url: str) -> dict[str, int]:
    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT job_type, COUNT(*)::int AS queued_count
            FROM background_job
            WHERE status = 'queued'
            GROUP BY job_type
            """
        )
    finally:
        await conn.close()

    return {str(row["job_type"]): int(row["queued_count"] or 0) for row in rows}


async def _fetch_freshness_lag_p95(*, database_url: str, lookback_hours: int) -> float:
    conn = await asyncpg.connect(database_url)
    try:
        row = await conn.fetchrow(
            """
            SELECT COALESCE(
                percentile_cont(0.95) WITHIN GROUP (ORDER BY freshness_lag_minutes),
                0
            )::float AS p95_freshness
            FROM source_sync_run
            WHERE started_at >= (NOW() - (($1::text || ' hours')::interval))
              AND freshness_lag_minutes IS NOT NULL
            """,
            str(max(1, int(lookback_hours))),
        )
    finally:
        await conn.close()
    return float((row["p95_freshness"] if row else 0.0) or 0.0)


def _hpa_to_state(*, pool: str, hpa_name: str, payload: dict[str, Any]) -> HPAPoolState:
    spec = dict(payload.get("spec") or {})
    metadata = dict(payload.get("metadata") or {})
    annotations = metadata.get("annotations")
    if not isinstance(annotations, dict):
        annotations = {}
    min_replicas = int(spec.get("minReplicas") or 1)
    max_replicas = int(spec.get("maxReplicas") or max(1, min_replicas))
    return HPAPoolState(
        pool=pool,
        hpa_name=hpa_name,
        min_replicas=max(1, min_replicas),
        max_replicas=max(1, max_replicas),
        annotations={str(key): str(value) for key, value in annotations.items()},
    )


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    enabled = _parse_bool(os.getenv("WORLD_AUTOSCALER_ENABLED"), default=True)
    if not enabled:
        return {
            "status": "disabled",
            "reason": "WORLD_AUTOSCALER_ENABLED=false",
            "timestamp": datetime.now(UTC).isoformat(),
        }

    database_url_raw = os.getenv("DROVI_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url_raw:
        raise RuntimeError("Missing DROVI_DATABASE_URL or DATABASE_URL.")
    database_url = _normalize_database_url(database_url_raw)

    namespace = args.namespace or os.getenv("WORLD_AUTOSCALER_NAMESPACE") or "drovi"
    pool_hpa_map = _load_pool_hpa_map(os.getenv("WORLD_AUTOSCALER_POOL_HPA_MAP"))
    cooldown_seconds = int(os.getenv("WORLD_AUTOSCALER_COOLDOWN_SECONDS") or 300)
    max_step = int(os.getenv("WORLD_AUTOSCALER_MAX_STEP") or 2)
    lookback_hours = int(os.getenv("WORLD_AUTOSCALER_FRESHNESS_LOOKBACK_HOURS") or 6)
    scale_down_queue_threshold = int(os.getenv("WORLD_AUTOSCALER_SCALE_DOWN_QUEUE_THRESHOLD") or 5)
    scale_down_freshness_threshold = int(
        os.getenv("WORLD_AUTOSCALER_SCALE_DOWN_FRESHNESS_THRESHOLD_MINUTES") or 20
    )
    fail_on_errors = _parse_bool(os.getenv("WORLD_AUTOSCALER_FAIL_ON_ERRORS"), default=True)

    job_counts, freshness_p95 = await asyncio.gather(
        _fetch_job_queue_counts(database_url=database_url),
        _fetch_freshness_lag_p95(database_url=database_url, lookback_hours=lookback_hours),
    )
    pool_queue_depths = aggregate_pool_queue_depths(job_counts)

    kube = InClusterKubernetesClient(namespace=namespace)
    now = datetime.now(UTC)

    decisions: list[dict[str, Any]] = []
    errors: list[str] = []
    applied = 0

    for pool, hpa_name in pool_hpa_map.items():
        try:
            hpa_payload = kube.get_hpa(hpa_name=hpa_name)
            state = _hpa_to_state(pool=pool, hpa_name=hpa_name, payload=hpa_payload)
            decision = build_scale_decision(
                state=state,
                queue_depth=int(pool_queue_depths.get(pool, 0)),
                freshness_lag_minutes=freshness_p95,
                now=now,
                cooldown_seconds=cooldown_seconds,
                max_step_change=max_step,
                scale_down_queue_threshold=scale_down_queue_threshold,
                scale_down_freshness_threshold_minutes=scale_down_freshness_threshold,
            )
            entry = decision.to_dict()
            if args.apply and decision.desired_min_replicas != decision.current_min_replicas:
                kube.patch_hpa_min_replicas(
                    hpa_name=decision.hpa_name,
                    min_replicas=decision.desired_min_replicas,
                    action=decision.action,
                    reason=decision.reason,
                    now=now,
                )
                applied += 1
                entry["applied"] = True
            else:
                entry["applied"] = False
            decisions.append(entry)
        except Exception as exc:
            errors.append(f"{pool}:{hpa_name}:{exc}")

    report = {
        "status": "ok" if not errors else "degraded",
        "timestamp": now.isoformat(),
        "namespace": namespace,
        "apply_mode": bool(args.apply),
        "cooldown_seconds": cooldown_seconds,
        "max_step_change": max_step,
        "freshness_lookback_hours": lookback_hours,
        "freshness_lag_p95_minutes": round(float(freshness_p95), 3),
        "queue_depths_by_pool": pool_queue_depths,
        "raw_job_queue_counts": job_counts,
        "decisions": decisions,
        "applied_changes": applied,
        "errors": errors,
    }
    if errors and fail_on_errors:
        raise RuntimeError(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Queue/freshness-driven world-brain autoscaling.")
    parser.add_argument("--namespace", default=None, help="Kubernetes namespace, defaults to WORLD_AUTOSCALER_NAMESPACE.")
    parser.add_argument("--apply", action="store_true", help="Apply patches to HPA minReplicas.")
    args = parser.parse_args()

    result = asyncio.run(_run(args))
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
