#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_LOG="${BACKUP_LOG:-$BACKUP_DIR/backup_verification.log}"
MINIO_BACKUP_DIR="${MINIO_BACKUP_DIR:-$BACKUP_DIR/minio}"

mkdir -p "$BACKUP_DIR"
touch "$BACKUP_LOG"

log() {
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "[$ts] $*" | tee -a "$BACKUP_LOG"
}

require_file() {
  local label="$1"
  local file="$2"
  if [ -z "$file" ]; then
    log "ERROR: Missing $label backup file."
    return 1
  fi
  if [ ! -s "$file" ]; then
    log "ERROR: $label backup file is empty: $file"
    return 1
  fi
  log "OK: $label backup verified: $file"
  return 0
}

log "Starting backup verification."

postgres_latest="$(ls -t "$BACKUP_DIR"/postgres_*.sql.gz 2>/dev/null | head -n 1 || true)"
falkor_latest="$(ls -t "$BACKUP_DIR"/falkordb_*.rdb 2>/dev/null | head -n 1 || true)"

require_file "Postgres" "$postgres_latest"
require_file "FalkorDB" "$falkor_latest"

if [ -d "$MINIO_BACKUP_DIR" ]; then
  minio_count="$(find "$MINIO_BACKUP_DIR" -type f | wc -l | tr -d ' ')"
  if [ "$minio_count" -eq 0 ]; then
    log "WARN: MinIO backup directory is empty: $MINIO_BACKUP_DIR"
  else
    log "OK: MinIO backup verified ($minio_count files): $MINIO_BACKUP_DIR"
  fi
else
  log "ERROR: MinIO backup directory missing: $MINIO_BACKUP_DIR"
  exit 1
fi

log "Backup verification completed successfully."
