# Backups + Disaster Recovery

## Postgres
Backup:
```
bash scripts/backup_postgres.sh
```
Restore:
```
bash scripts/restore_postgres.sh /path/to/backup.sql.gz
```

## FalkorDB (RedisGraph)
Backup (RDB snapshot):
```
bash scripts/backup_falkordb.sh
```

## MinIO (Evidence)
Backup using `mc mirror`:
```
bash scripts/backup_minio.sh
```

## Runbook
1. Verify backups nightly.
2. Test restores weekly in staging.
3. Document RTO/RPO targets and verify in quarterly DR drills.

## GitHub Actions
- `intelligence-backups.yml` runs nightly backup + restore verification.
