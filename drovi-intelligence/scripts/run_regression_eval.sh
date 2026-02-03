#!/usr/bin/env bash
set -euo pipefail

MIN_F1="${EVAL_MIN_F1:-0.6}"

RESULTS="$(python -m evaluation.evaluate)"
echo "$RESULTS"

F1_DECISIONS="$(echo "$RESULTS" | python -c 'import json,sys; data=json.load(sys.stdin); print(data["decisions"]["f1"])')"

F1_COMMITMENTS="$(echo "$RESULTS" | python -c 'import json,sys; data=json.load(sys.stdin); print(data["commitments"]["f1"])')"

python - <<PY
import sys
min_f1=float("$MIN_F1")
f1_dec=float("$F1_DECISIONS")
f1_com=float("$F1_COMMITMENTS")
if f1_dec < min_f1 or f1_com < min_f1:
    print(f"Regression gate failed: decisions={f1_dec:.3f} commitments={f1_com:.3f} min={min_f1}")
    sys.exit(1)
print(f"Regression gate passed: decisions={f1_dec:.3f} commitments={f1_com:.3f}")
PY
