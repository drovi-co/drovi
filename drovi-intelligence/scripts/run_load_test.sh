#!/usr/bin/env bash
set -euo pipefail

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required. Install: https://k6.io/docs/get-started/installation/"
  exit 1
fi

LIVE_BASE_URL="${LIVE_BASE_URL:-http://localhost:8000/api/v1}"
LIVE_API_KEY="${LIVE_API_KEY:-}"
LIVE_ORG_ID="${LIVE_ORG_ID:-org_demo}"

LIVE_BASE_URL="$LIVE_BASE_URL" LIVE_API_KEY="$LIVE_API_KEY" LIVE_ORG_ID="$LIVE_ORG_ID" \
  k6 run tests/load/live_ingest.js
