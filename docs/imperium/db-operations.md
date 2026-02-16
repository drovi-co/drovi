# Imperium DB Backup and Rollback

## Backup

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/drovi \
  /Users/jeremyscatigna/project-memory/scripts/imperium/db_backup.sh
```

Optional output directory:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/drovi \
  /Users/jeremyscatigna/project-memory/scripts/imperium/db_backup.sh backups/imperium
```

## Restore / Rollback

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/drovi \
  /Users/jeremyscatigna/project-memory/scripts/imperium/db_restore.sh backups/imperium/<file>.dump
```

## Notes

- Take a fresh backup before applying new Imperium migrations.
- Restore uses `--clean --if-exists` to recreate objects from the backup snapshot.
- Validate key endpoints after restore:
  - `/api/v1/imperium/ready`
  - `/api/v1/imperium/brief/today`
  - `/api/v1/imperium/portfolio/overview`
