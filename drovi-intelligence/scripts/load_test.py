#!/usr/bin/env python3
"""
Simple load test for /analyze using the gold dataset.
"""

import json
import os
import random
import statistics
import time
from pathlib import Path

import httpx


def main() -> None:
    api_base = os.getenv("LOAD_API_BASE_URL", "http://localhost:8000/api/v1")
    api_key = os.getenv("LOAD_API_KEY")
    org_id = os.getenv("LOAD_ORG_ID", "load-test")
    concurrency = int(os.getenv("LOAD_CONCURRENCY", "5"))
    total_requests = int(os.getenv("LOAD_REQUESTS", "50"))

    if not api_key:
        raise SystemExit("LOAD_API_KEY is required")

    gold_path = Path(__file__).resolve().parents[1] / "evaluation" / "goldset.jsonl"
    records = [json.loads(line) for line in gold_path.read_text().splitlines() if line.strip()]
    if not records:
        raise SystemExit("Gold dataset empty")

    headers = {"X-API-Key": api_key}
    latencies = []

    def build_payload(content: str) -> dict:
        return {
            "content": content,
            "source_type": "manual",
            "organization_id": org_id,
            "extract_commitments": True,
            "extract_decisions": True,
            "analyze_risk": False,
            "deduplicate": False,
        }

    def run_batch(client: httpx.Client, batch: list[str]) -> None:
        for content in batch:
            payload = build_payload(content)
            start = time.time()
            resp = client.post(f"{api_base}/analyze", json=payload, headers=headers, timeout=120)
            resp.raise_for_status()
            latencies.append(time.time() - start)

    # Prepare randomized workload
    contents = [random.choice(records)["content"] for _ in range(total_requests)]
    batches = [contents[i::concurrency] for i in range(concurrency)]

    start_total = time.time()
    with httpx.Client(timeout=120) as client:
        for batch in batches:
            run_batch(client, batch)
    duration = time.time() - start_total

    if latencies:
        p50 = statistics.median(latencies)
        p95 = statistics.quantiles(latencies, n=20)[18]
        avg = statistics.mean(latencies)
    else:
        p50 = p95 = avg = 0.0

    print(json.dumps({
        "requests": total_requests,
        "concurrency": concurrency,
        "duration_seconds": round(duration, 3),
        "rps": round(total_requests / duration, 3) if duration > 0 else 0.0,
        "latency_avg_seconds": round(avg, 3),
        "latency_p50_seconds": round(p50, 3),
        "latency_p95_seconds": round(p95, 3),
    }, indent=2))


if __name__ == "__main__":
    main()
