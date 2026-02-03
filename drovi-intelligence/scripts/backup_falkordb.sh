#!/usr/bin/env bash
set -euo pipefail

HOST="${FALKORDB_HOST:-localhost}"
PORT="${FALKORDB_PORT:-6379}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$OUT_DIR/falkordb_${STAMP}.rdb"

redis-cli -h "$HOST" -p "$PORT" --rdb "$OUT_FILE"
echo "FalkorDB backup written to $OUT_FILE"
