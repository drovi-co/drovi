# World Brain Runbook: Zero-Downtime DB and Graph Migrations

Scope:
- Postgres schema migrations (`alembic`)
- Graph schema evolution (FalkorDB)

## 1. Migration Pattern

1. Expand phase:
- add nullable columns/tables/indexes
- keep old readers/writers intact

2. Dual-write phase:
- write both old and new fields
- add integrity checks and parity sampling

3. Cutover phase:
- shift reads to new schema behind feature flag
- monitor latency/error regressions

4. Contract phase:
- remove legacy paths only after stable window

## 2. Preflight Checks

1. CI migration symmetry tests are green.
2. Staging replay and smoke tests are green.
3. Backup snapshots for Postgres and graph completed.
4. Rollback SQL/steps are prepared and reviewed.

## 3. Execution Steps

1. Apply expand migration.
2. Deploy compatible application version.
3. Enable dual-write and run parity checks.
4. Cut over reads to new schema.
5. Observe for one full ingest cycle before contract.

## 4. Rollback Strategy

1. If expand fails: rollback migration and redeploy previous image.
2. If dual-write parity drifts: disable dual-write and investigate data repair.
3. If cutover fails: restore old read path flag and replay failed windows.

## 5. Exit Criteria

1. No integrity drift in parity samples.
2. p95 latency/error remain within SLO.
3. Replay from checkpoints remains gap/duplicate safe.
