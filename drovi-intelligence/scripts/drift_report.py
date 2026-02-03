#!/usr/bin/env python3
"""
Compare current evaluation metrics against baseline to detect drift.
"""

import json
from pathlib import Path

from evaluation.evaluate import run_eval


def main() -> None:
    baseline_path = Path(__file__).resolve().parents[1] / "evaluation" / "baseline_metrics.json"
    if not baseline_path.exists():
        raise SystemExit("baseline_metrics.json missing. Create it after a trusted eval run.")

    baseline = json.loads(baseline_path.read_text())
    current = run_eval()

    def delta(current_val: float, base_val: float) -> float:
        return round(current_val - base_val, 4)

    report = {
        "baseline": baseline,
        "current": current,
        "delta": {
            "decisions_f1": delta(current["decisions"]["f1"], baseline["decisions"]["f1"]),
            "commitments_f1": delta(current["commitments"]["f1"], baseline["commitments"]["f1"]),
        },
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
