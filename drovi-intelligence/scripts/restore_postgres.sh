#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 /path/to/backup.sql.gz"
  exit 1
fi

PG_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/drovi}"
IN_FILE="$1"

gunzip -c "$IN_FILE" | psql "$PG_URL"
echo "Postgres restore complete"
