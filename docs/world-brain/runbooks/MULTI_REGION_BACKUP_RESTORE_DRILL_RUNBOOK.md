# World Brain Runbook: Multi-Region Backup and Restore Drill

Scope:
- Layers: evidence store, lakehouse metadata and partitions
- Regions: primary + secondary failover pair

Cadence:
- Execute at least monthly in staging and quarterly in production

## 1. Drill Objectives

1. Validate RTO/RPO targets for each critical data layer.
2. Verify checksum integrity after restore.
3. Validate read-path continuity for world twin and tape workflows.

## 2. Pre-Drill Checklist

1. Freeze schema migrations during drill window.
2. Capture baseline metrics:
- current event throughput
- snapshot sizes
- checkpoint positions

3. Confirm target definitions:
- `rto_target_minutes`
- `rpo_target_minutes`

## 3. Execution Steps

1. Trigger backup snapshot in primary region for each layer.
2. Replicate snapshots to secondary region.
3. Restore into isolated secondary environment.
4. Run integrity verification:
- manifest checksums
- row/object counts
- random record spot checks across high-risk tenants

5. Replay delta window and confirm RPO loss is within target.

## 4. Validation

1. Compare observed RTO/RPO vs targets.
2. Validate critical queries:
- latest twin snapshot retrieval
- tape event retrieval with proof bundle
- sample lakehouse query on silver/gold tables

3. Record checksum match ratio.

## 5. Pass/Fail Rules

Pass requires:
1. Observed RTO <= target for each layer.
2. Observed RPO <= target for each layer.
3. `integrity_ok=true` and checksum match ratio >= `0.999`.

Fail requires:
1. Escalation ticket with root-cause analysis.
2. Corrective action plan with owner and due date.
3. Re-run drill within 7 days.

