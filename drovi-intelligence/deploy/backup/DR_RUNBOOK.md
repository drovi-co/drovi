# Disaster Recovery Runbook

## Goals
- RPO: 24 hours (or tighter for enterprise customers)
- RTO: 2 hours for core services

## Preconditions
- Nightly backups are enabled for Postgres, FalkorDB, and MinIO
- Restore verification runs weekly in staging
- Runbooks are stored in this repo and in internal docs

## Incident Steps
1. Identify scope: data loss vs service outage
2. Freeze writes if needed (disable ingestion/scheduler)
3. Restore Postgres from most recent verified backup
4. Restore FalkorDB from latest snapshot
5. Restore MinIO evidence store (or ensure evidence storage is intact)
6. Run smoke checks:
   - `/health`
   - `/ready`
   - Sample `/uios/v2`
   - Sample `/signals/events`
7. Resume ingestion + verify metrics

## Verification
- Validate UIO counts vs prior baseline
- Ensure UEM ingestion resumes and no backlogs
- Run regression eval if time allows

## Postmortem
- Document timeline and root cause
- Update runbook if any step failed
- Add alerts or guardrails to prevent recurrence
