# World Brain Backup and Restore Policy

## Protected Layers

1. Postgres metadata and ledgers.
2. FalkorDB graph state.
3. Evidence object store.
4. Lakehouse metadata and partitions.

## Backup Cadence

1. Daily backups for all layers.
2. Weekly restore verification for Postgres and graph.
3. Monthly DR drill for cross-layer integrity and RTO/RPO validation.

## Retention

1. Daily snapshots retained for 30 days.
2. Weekly snapshots retained for 12 weeks.
3. Monthly snapshots retained for 12 months.

## Restore Rules

1. Restore tests must run in isolated target environment.
2. Checksums and row/object counts must be validated before cutover.
3. Replay gap window must be reconciled after restore.

## Governance

1. Backup jobs and restore drills emit auditable artifacts.
2. Any failed restore drill requires remediation ticket and re-run within 7 days.
3. Backup policy changes require infra and security owner approval.
