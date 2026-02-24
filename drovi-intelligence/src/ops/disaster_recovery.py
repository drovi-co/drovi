"""Multi-region backup/restore drill planning and evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True, slots=True)
class DrillTarget:
    layer: str
    primary_region: str
    secondary_region: str
    rto_target_minutes: int
    rpo_target_minutes: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "layer": self.layer,
            "primary_region": self.primary_region,
            "secondary_region": self.secondary_region,
            "rto_target_minutes": self.rto_target_minutes,
            "rpo_target_minutes": self.rpo_target_minutes,
        }


class MultiRegionDrillPlanner:
    """Plans and evaluates backup/restore drills for evidence and lakehouse layers."""

    def build_plan(
        self,
        *,
        organization_id: str,
        targets: list[DrillTarget],
        initiated_by: str = "system",
    ) -> dict[str, Any]:
        if not targets:
            raise ValueError("at least one drill target is required")

        started_at = datetime.now(UTC).isoformat()
        checklist: list[dict[str, Any]] = []
        for target in targets:
            checklist.extend(
                [
                    {
                        "layer": target.layer,
                        "step": "snapshot_primary",
                        "region": target.primary_region,
                    },
                    {
                        "layer": target.layer,
                        "step": "replicate_to_secondary",
                        "region": target.secondary_region,
                    },
                    {
                        "layer": target.layer,
                        "step": "restore_secondary",
                        "region": target.secondary_region,
                    },
                    {
                        "layer": target.layer,
                        "step": "verify_integrity",
                        "region": target.secondary_region,
                    },
                ]
            )

        return {
            "organization_id": organization_id,
            "initiated_by": initiated_by,
            "started_at": started_at,
            "targets": [item.to_dict() for item in targets],
            "checklist": checklist,
        }

    def evaluate_results(
        self,
        *,
        targets: list[DrillTarget],
        results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not targets:
            raise ValueError("at least one target is required")

        result_by_layer = {str(item.get("layer")): item for item in results}
        target_reports: list[dict[str, Any]] = []
        passed = True

        for target in targets:
            sample = result_by_layer.get(target.layer, {})
            observed_rto = max(0, _safe_int(sample.get("observed_rto_minutes"), 9_999))
            observed_rpo = max(0, _safe_int(sample.get("observed_rpo_minutes"), 9_999))
            integrity_ok = bool(sample.get("integrity_ok", False))
            checksum_match_ratio = _safe_float(sample.get("checksum_match_ratio"), 0.0)

            rto_pass = observed_rto <= target.rto_target_minutes
            rpo_pass = observed_rpo <= target.rpo_target_minutes
            checksum_pass = checksum_match_ratio >= 0.999
            layer_pass = bool(rto_pass and rpo_pass and integrity_ok and checksum_pass)
            if not layer_pass:
                passed = False

            target_reports.append(
                {
                    "layer": target.layer,
                    "primary_region": target.primary_region,
                    "secondary_region": target.secondary_region,
                    "observed_rto_minutes": observed_rto,
                    "observed_rpo_minutes": observed_rpo,
                    "rto_target_minutes": target.rto_target_minutes,
                    "rpo_target_minutes": target.rpo_target_minutes,
                    "integrity_ok": integrity_ok,
                    "checksum_match_ratio": round(checksum_match_ratio, 6),
                    "passed": layer_pass,
                }
            )

        return {
            "passed": passed,
            "target_count": len(targets),
            "reports": target_reports,
        }

