#!/usr/bin/env bash
set -euo pipefail

MIN_F1="${EVAL_MIN_F1:-0.6}"
MIN_F1_TASKS="${EVAL_MIN_F1_TASKS:-0.4}"
MIN_F1_RISKS="${EVAL_MIN_F1_RISKS:-0.4}"
MIN_F1_CLAIMS="${EVAL_MIN_F1_CLAIMS:-0.4}"
MAX_HALLUCINATION="${EVAL_MAX_HALLUCINATION:-0.4}"

RESULTS="$(python -m evaluation.evaluate)"
echo "$RESULTS"

python - <<PY
import json
import os
import sys

data = json.loads("""$RESULTS""")

min_f1 = float("$MIN_F1")
min_f1_tasks = float("$MIN_F1_TASKS")
min_f1_risks = float("$MIN_F1_RISKS")
min_f1_claims = float("$MIN_F1_CLAIMS")
max_hallucination = float("$MAX_HALLUCINATION")

def check(label, min_f1, max_h):
    metrics = data[label]
    f1 = float(metrics["f1"])
    hall = float(metrics["hallucination_rate"])
    if f1 < min_f1:
        print(f"Regression gate failed: {label} f1={f1:.3f} min={min_f1}")
        return False
    if hall > max_h:
        print(f"Regression gate failed: {label} hallucination_rate={hall:.3f} max={max_h}")
        return False
    return True

ok = True
ok &= check("decisions", min_f1, max_hallucination)
ok &= check("commitments", min_f1, max_hallucination)
ok &= check("tasks", min_f1_tasks, max_hallucination)
ok &= check("risks", min_f1_risks, max_hallucination)
ok &= check("claims", min_f1_claims, max_hallucination)

if not ok:
    sys.exit(1)

print("Regression gate passed.")
PY
