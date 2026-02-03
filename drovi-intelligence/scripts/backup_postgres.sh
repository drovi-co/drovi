#!/usr/bin/env bash
set -euo pipefail

PG_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/drovi}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$OUT_DIR/postgres_${STAMP}.sql.gz"

pg_dump "$PG_URL" | gzip > "$OUT_FILE"
echo "Postgres backup written to $OUT_FILE"
