"""Evaluation harness for extraction accuracy."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import httpx


@dataclass
class Metrics:
    precision: float
    recall: float
    f1: float


def _normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _score(pred: Iterable[str], gold: Iterable[str]) -> Metrics:
    pred_set = {_normalize(p) for p in pred if p}
    gold_set = {_normalize(g) for g in gold if g}

    if not pred_set and not gold_set:
        return Metrics(precision=1.0, recall=1.0, f1=1.0)
    if not pred_set or not gold_set:
        return Metrics(precision=0.0, recall=0.0, f1=0.0)

    true_pos = len(pred_set & gold_set)
    precision = true_pos / max(len(pred_set), 1)
    recall = true_pos / max(len(gold_set), 1)
    f1 = (2 * precision * recall) / max((precision + recall), 1e-9)
    return Metrics(precision=precision, recall=recall, f1=f1)


def _load_gold(path: Path) -> list[dict]:
    records = []
    for line in path.read_text().splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def _fetch_prediction(api_base: str, api_key: str, org_id: str, content: str) -> dict:
    payload = {
        "content": content,
        "source_type": "manual",
        "organization_id": org_id,
        "extract_commitments": True,
        "extract_decisions": True,
        "analyze_risk": False,
        "deduplicate": False,
    }
    auth_mode = os.getenv("EVAL_AUTH_MODE", "x-api-key")
    if auth_mode == "bearer":
        headers = {"Authorization": f"Bearer {api_key}"}
    else:
        headers = {"X-API-Key": api_key}
    with httpx.Client(timeout=60) as client:
        response = client.post(f"{api_base}/analyze", json=payload, headers=headers)
        response.raise_for_status()
        return response.json()


def run_eval() -> dict:
    api_base = os.getenv("EVAL_API_BASE_URL", "http://localhost:8000/api/v1")
    api_key = os.getenv("EVAL_API_KEY")
    org_id = os.getenv("EVAL_ORG_ID", "eval")

    if not api_key:
        raise RuntimeError("EVAL_API_KEY is required to run evaluation")

    gold_records = _load_gold(Path(__file__).parent / "goldset.jsonl")

    decision_metrics = []
    commitment_metrics = []

    for record in gold_records:
        prediction = _fetch_prediction(api_base, api_key, org_id, record["content"])
        decisions = [d.get("title", "") for d in prediction.get("decisions", [])]
        commitments = [c.get("title", "") for c in prediction.get("commitments", [])]

        decision_metrics.append(_score(decisions, record["expected"]["decisions"]))
        commitment_metrics.append(_score(commitments, record["expected"]["commitments"]))

    def _aggregate(metrics: list[Metrics]) -> Metrics:
        if not metrics:
            return Metrics(precision=0.0, recall=0.0, f1=0.0)
        precision = sum(m.precision for m in metrics) / len(metrics)
        recall = sum(m.recall for m in metrics) / len(metrics)
        f1 = sum(m.f1 for m in metrics) / len(metrics)
        return Metrics(precision=precision, recall=recall, f1=f1)

    decision = _aggregate(decision_metrics)
    commitment = _aggregate(commitment_metrics)

    return {
        "decisions": decision.__dict__,
        "commitments": commitment.__dict__,
        "samples": len(gold_records),
    }


if __name__ == "__main__":
    results = run_eval()
    print(json.dumps(results, indent=2))
