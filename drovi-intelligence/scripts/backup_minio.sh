#!/usr/bin/env bash
set -euo pipefail

MINIO_ALIAS="${MINIO_ALIAS:-drovi}"
MINIO_URL="${MINIO_URL:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-drovi-evidence}"
OUT_DIR="${BACKUP_DIR:-./backups/minio}"

mkdir -p "$OUT_DIR"

mc alias set "$MINIO_ALIAS" "$MINIO_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc mirror "$MINIO_ALIAS/$MINIO_BUCKET" "$OUT_DIR"
echo "MinIO backup mirrored to $OUT_DIR"
