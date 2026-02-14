#!/usr/bin/env python3
"""
Lightweight performance budget probe (informational).

This is intentionally dependency-free and CI-friendly:
- Uses urllib from stdlib
- Measures end-to-end wall time
- Emits JSON suitable for artifact upload and trend tracking

NOTE: This does not enforce thresholds yet; it records p50/p95 so we can set
realistic budgets once we have baseline data from pilot-scale stacks.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str


DEFAULT_ENDPOINTS: list[Endpoint] = [
    Endpoint("GET", "/health"),
    Endpoint("GET", "/api/v1/auth/me"),
    Endpoint("GET", "/api/v1/connections/connectors"),
]


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, int(math.ceil(p * len(sorted_values)) - 1)))
    return sorted_values[idx]


def _probe(base_url: str, endpoint: Endpoint, samples: int, timeout_s: float) -> dict[str, Any]:
    durations_ms: list[int] = []
    status_counts: Counter[int] = Counter()
    errors: list[str] = []

    url = f"{base_url.rstrip('/')}{endpoint.path}"
    for _ in range(samples):
        req = urllib.request.Request(url=url, method=endpoint.method)
        req.add_header("User-Agent", "drovi-perf-budget/0")

        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                status_counts[int(getattr(resp, "status", 0) or 0)] += 1
                # Always drain small responses to measure real proxy/app work.
                _ = resp.read()
        except urllib.error.HTTPError as exc:
            # Treat HTTP errors as signal, not transport failure.
            status_counts[int(getattr(exc, "code", 0) or 0)] += 1
            try:
                _ = exc.read()
            except Exception:
                pass
        except Exception as exc:  # noqa: BLE001 - this is an observational probe.
            errors.append(f"{type(exc).__name__}: {exc}")
        finally:
            elapsed_ms = int(max(0.0, (time.perf_counter() - started) * 1000.0))
            durations_ms.append(elapsed_ms)

    durations_ms_sorted = sorted(durations_ms)
    return {
        "method": endpoint.method,
        "path": endpoint.path,
        "samples": samples,
        "timeout_s": timeout_s,
        "min_ms": durations_ms_sorted[0] if durations_ms_sorted else None,
        "p50_ms": int(round(_percentile([float(x) for x in durations_ms_sorted], 0.50))),
        "p95_ms": int(round(_percentile([float(x) for x in durations_ms_sorted], 0.95))),
        "max_ms": durations_ms_sorted[-1] if durations_ms_sorted else None,
        "status_counts": dict(status_counts),
        "error_count": len(errors),
        "errors_sample": errors[:3],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3001", help="Base URL (default: http://localhost:3001)")
    parser.add_argument("--samples", type=int, default=25, help="Samples per endpoint (default: 25)")
    parser.add_argument("--timeout-s", type=float, default=5.0, help="Per-request timeout seconds (default: 5)")
    parser.add_argument("--output", default="perf/perf-budget.json", help="Output JSON path")
    args = parser.parse_args(argv)

    results = {
        "generated_at": _utc_iso(),
        "base_url": args.base_url,
        "samples": args.samples,
        "endpoints": {},
    }

    for ep in DEFAULT_ENDPOINTS:
        results["endpoints"][f"{ep.method} {ep.path}"] = _probe(
            args.base_url, ep, samples=args.samples, timeout_s=args.timeout_s
        )

    output_path = args.output
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
        f.write("\n")

    # Human-readable summary for CI logs.
    for key, payload in results["endpoints"].items():
        print(f"{key}: p50={payload['p50_ms']}ms p95={payload['p95_ms']}ms errors={payload['error_count']}")

    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
