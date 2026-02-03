#!/usr/bin/env python3
"""
Async load test for /analyze using the gold dataset.
Validates extraction latency and UEM persistence latency.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import statistics
import time
from pathlib import Path
from typing import Any

import httpx


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    k = (len(ordered) - 1) * pct
    f = int(k)
    c = min(f + 1, len(ordered) - 1)
    if f == c:
        return ordered[f]
    return ordered[f] + (ordered[c] - ordered[f]) * (k - f)


def parse_histogram_buckets(metrics_text: str, metric_name: str) -> dict[float, float]:
    bucket_re = re.compile(rf"^{re.escape(metric_name)}\\{{([^}}]+)\\}}\\s+([0-9eE+\\.-]+)$")
    buckets: dict[float, float] = {}
    for line in metrics_text.splitlines():
        match = bucket_re.match(line.strip())
        if not match:
            continue
        labels_str, value_str = match.groups()
        labels = {}
        for chunk in labels_str.split(","):
            if "=" not in chunk:
                continue
            key, raw = chunk.split("=", 1)
            labels[key.strip()] = raw.strip().strip('"')
        le_value = labels.get("le")
        if le_value is None:
            continue
        le = float("inf") if le_value == "+Inf" else float(le_value)
        buckets[le] = buckets.get(le, 0.0) + float(value_str)
    return buckets


def histogram_quantile(phi: float, buckets: dict[float, float]) -> float | None:
    if not buckets:
        return None
    sorted_buckets = sorted(buckets.items(), key=lambda item: item[0])
    total = sorted_buckets[-1][1]
    if total <= 0:
        return None
    rank = phi * total
    prev_le = 0.0
    prev_count = 0.0
    for le, count in sorted_buckets:
        if count >= rank:
            if le == float("inf"):
                return prev_le
            bucket_count = count - prev_count
            if bucket_count <= 0:
                return le
            fraction = (rank - prev_count) / bucket_count
            return prev_le + (le - prev_le) * fraction
        prev_le = le
        prev_count = count
    return sorted_buckets[-1][0]


async def fetch_metrics(client: httpx.AsyncClient, metrics_url: str) -> str:
    resp = await client.get(metrics_url, timeout=30)
    resp.raise_for_status()
    return resp.text


async def main() -> None:
    api_base = os.getenv("LOAD_API_BASE_URL", "http://localhost:8000/api/v1").rstrip("/")
    api_key = os.getenv("LOAD_API_KEY")
    org_id = os.getenv("LOAD_ORG_ID", "load-test")
    concurrency = int(os.getenv("LOAD_CONCURRENCY", "5"))
    total_requests = int(os.getenv("LOAD_REQUESTS", "50"))
    max_p95 = float(os.getenv("LOAD_MAX_P95_SECONDS", "30"))
    max_uem_p95 = float(os.getenv("LOAD_MAX_UEM_P95_SECONDS", "0.5"))

    if not api_key:
        raise SystemExit("LOAD_API_KEY is required")

    gold_path = Path(__file__).resolve().parents[1] / "evaluation" / "goldset.jsonl"
    records = [json.loads(line) for line in gold_path.read_text().splitlines() if line.strip()]
    if not records:
        raise SystemExit("Gold dataset empty")

    headers = {"X-API-Key": api_key}
    latencies: list[float] = []
    errors: list[str] = []

    def build_payload(content: str) -> dict[str, Any]:
        return {
            "content": content,
            "source_type": "manual",
            "organization_id": org_id,
            "extract_commitments": True,
            "extract_decisions": True,
            "analyze_risk": False,
            "deduplicate": False,
        }

    async def run_request(client: httpx.AsyncClient, content: str, sem: asyncio.Semaphore) -> None:
        async with sem:
            payload = build_payload(content)
            start = time.perf_counter()
            try:
                resp = await client.post(f"{api_base}/analyze", json=payload, headers=headers, timeout=120)
                resp.raise_for_status()
                latencies.append(time.perf_counter() - start)
            except Exception as exc:
                errors.append(str(exc))

    contents = [random.choice(records)["content"] for _ in range(total_requests)]
    sem = asyncio.Semaphore(max(1, concurrency))

    start_total = time.perf_counter()
    async with httpx.AsyncClient(timeout=120) as client:
        await asyncio.gather(*(run_request(client, content, sem) for content in contents))
    duration = time.perf_counter() - start_total

    p50 = percentile(latencies, 0.50)
    p95 = percentile(latencies, 0.95)
    avg = statistics.mean(latencies) if latencies else 0.0

    metrics_url = f"{api_base}/monitoring/metrics"
    uem_p95 = None
    try:
        async with httpx.AsyncClient(timeout=30) as metrics_client:
            metrics_text = await fetch_metrics(metrics_client, metrics_url)
        buckets = parse_histogram_buckets(
            metrics_text,
            "drovi_uem_persist_duration_seconds_bucket",
        )
        uem_p95 = histogram_quantile(0.95, buckets)
    except Exception as exc:
        errors.append(f"metrics_fetch_failed: {exc}")

    passed = True
    failures: list[str] = []

    if errors:
        passed = False
        failures.append(f"errors={len(errors)}")
    if p95 > max_p95:
        passed = False
        failures.append(f"extraction_p95_exceeded={p95:.3f}s")
    if uem_p95 is None:
        passed = False
        failures.append("uem_p95_missing")
    elif uem_p95 > max_uem_p95:
        passed = False
        failures.append(f"uem_p95_exceeded={uem_p95:.3f}s")

    result = {
        "requests": total_requests,
        "concurrency": concurrency,
        "duration_seconds": round(duration, 3),
        "rps": round(total_requests / duration, 3) if duration > 0 else 0.0,
        "latency_avg_seconds": round(avg, 3),
        "latency_p50_seconds": round(p50, 3),
        "latency_p95_seconds": round(p95, 3),
        "uem_p95_seconds": round(uem_p95, 3) if uem_p95 is not None else None,
        "thresholds": {
            "max_extraction_p95_seconds": max_p95,
            "max_uem_p95_seconds": max_uem_p95,
        },
        "passed": passed,
        "failures": failures,
    }

    print(json.dumps(result, indent=2))

    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
