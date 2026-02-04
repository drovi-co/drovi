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
    hallucination_rate: float
    miss_rate: float
    tp: int
    fp: int
    fn: int
    pred_count: int
    gold_count: int


def _normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _score(pred: Iterable[str], gold: Iterable[str]) -> Metrics:
    pred_set = {_normalize(p) for p in pred if p}
    gold_set = {_normalize(g) for g in gold if g}

    pred_count = len(pred_set)
    gold_count = len(gold_set)

    if not pred_set and not gold_set:
        return Metrics(
            precision=1.0,
            recall=1.0,
            f1=1.0,
            hallucination_rate=0.0,
            miss_rate=0.0,
            tp=0,
            fp=0,
            fn=0,
            pred_count=0,
            gold_count=0,
        )

    true_pos = len(pred_set & gold_set)
    false_pos = len(pred_set - gold_set)
    false_neg = len(gold_set - pred_set)

    precision = true_pos / max(pred_count, 1)
    recall = true_pos / max(gold_count, 1)
    f1 = (2 * precision * recall) / max((precision + recall), 1e-9)
    hallucination_rate = false_pos / max(pred_count, 1) if pred_count else 0.0
    miss_rate = false_neg / max(gold_count, 1) if gold_count else 0.0

    return Metrics(
        precision=precision,
        recall=recall,
        f1=f1,
        hallucination_rate=hallucination_rate,
        miss_rate=miss_rate,
        tp=true_pos,
        fp=false_pos,
        fn=false_neg,
        pred_count=pred_count,
        gold_count=gold_count,
    )


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
        "analyze_risk": True,
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

    decision_metrics: list[Metrics] = []
    commitment_metrics: list[Metrics] = []
    task_metrics: list[Metrics] = []
    risk_metrics: list[Metrics] = []
    claim_metrics: list[Metrics] = []

    for record in gold_records:
        prediction = _fetch_prediction(api_base, api_key, org_id, record["content"])
        expected = record.get("expected", {})

        decisions = [d.get("title", "") for d in prediction.get("decisions", [])]
        commitments = [c.get("title", "") for c in prediction.get("commitments", [])]
        tasks = [t.get("title", "") for t in prediction.get("tasks", [])]
        risks = [r.get("title", "") for r in prediction.get("risks", [])]
        claims = [cl.get("content", "") for cl in prediction.get("claims", [])]

        decision_metrics.append(_score(decisions, expected.get("decisions", [])))
        commitment_metrics.append(_score(commitments, expected.get("commitments", [])))
        task_metrics.append(_score(tasks, expected.get("tasks", [])))
        risk_metrics.append(_score(risks, expected.get("risks", [])))
        claim_metrics.append(_score(claims, expected.get("claims", [])))

    def _aggregate(metrics: list[Metrics]) -> dict:
        if not metrics:
            return {
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "hallucination_rate": 0.0,
                "miss_rate": 0.0,
                "tp": 0,
                "fp": 0,
                "fn": 0,
                "pred_count": 0,
                "gold_count": 0,
                "micro_precision": 0.0,
                "micro_recall": 0.0,
                "micro_f1": 0.0,
                "micro_hallucination_rate": 0.0,
                "micro_miss_rate": 0.0,
            }

        precision = sum(m.precision for m in metrics) / len(metrics)
        recall = sum(m.recall for m in metrics) / len(metrics)
        f1 = sum(m.f1 for m in metrics) / len(metrics)
        hallucination_rate = sum(m.hallucination_rate for m in metrics) / len(metrics)
        miss_rate = sum(m.miss_rate for m in metrics) / len(metrics)

        tp = sum(m.tp for m in metrics)
        fp = sum(m.fp for m in metrics)
        fn = sum(m.fn for m in metrics)
        pred_count = sum(m.pred_count for m in metrics)
        gold_count = sum(m.gold_count for m in metrics)

        micro_precision = tp / max(pred_count, 1) if pred_count else 1.0 if gold_count == 0 else 0.0
        micro_recall = tp / max(gold_count, 1) if gold_count else 1.0 if pred_count == 0 else 0.0
        micro_f1 = (2 * micro_precision * micro_recall) / max((micro_precision + micro_recall), 1e-9)
        micro_hallucination_rate = fp / max(pred_count, 1) if pred_count else 0.0
        micro_miss_rate = fn / max(gold_count, 1) if gold_count else 0.0

        return {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "hallucination_rate": hallucination_rate,
            "miss_rate": miss_rate,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "pred_count": pred_count,
            "gold_count": gold_count,
            "micro_precision": micro_precision,
            "micro_recall": micro_recall,
            "micro_f1": micro_f1,
            "micro_hallucination_rate": micro_hallucination_rate,
            "micro_miss_rate": micro_miss_rate,
        }

    decision = _aggregate(decision_metrics)
    commitment = _aggregate(commitment_metrics)
    tasks = _aggregate(task_metrics)
    risks = _aggregate(risk_metrics)
    claims = _aggregate(claim_metrics)

    return {
        "decisions": decision,
        "commitments": commitment,
        "tasks": tasks,
        "risks": risks,
        "claims": claims,
        "samples": len(gold_records),
    }


if __name__ == "__main__":
    results = run_eval()
    print(json.dumps(results, indent=2))
