# AgentOS Backup + Recovery Drill

## Goal
Verify that AgentOS control-plane and run-store data can be restored within RTO/RPO targets.

## Critical Tables
- `agent_role`
- `agent_profile`
- `agent_playbook`
- `agent_deployment`
- `agent_trigger`
- `agent_run`
- `agent_run_step`
- `agent_work_product`
- `agent_action_approval`
- `agent_run_quality_score`
- `continuum_agent_migration`
- `continuum_shadow_validation`

## Drill Cadence
- Weekly: restore validation in staging.
- Monthly: full restore rehearsal from production snapshots in isolated environment.

## Procedure
1. Create fresh backups:
   - `bash scripts/backup_postgres.sh`
   - `bash scripts/backup_falkordb.sh`
   - `bash scripts/backup_minio.sh`
2. Validate backup artifacts:
   - `bash scripts/verify_backups.sh`
3. Restore Postgres into isolated DB:
   - `bash scripts/restore_postgres.sh /path/to/backup.sql.gz`
4. Validate row counts and referential integrity for critical tables.
5. Run smoke checks:
   - list deployments
   - dispatch a run
   - list approvals
   - fetch quality trends
6. Record total restore time and data loss window.

## Pass Criteria
- RTO <= 60 minutes.
- RPO <= 15 minutes.
- All critical API smoke checks pass.
- No broken foreign keys in AgentOS tables.

## Failure Handling
1. Escalate as `SEV-2` if drill fails.
2. Open remediation tasks with owner and due date.
3. Re-run drill within 48 hours after fix.
