#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="$REPO_ROOT/apps/macos/DroviRecorder/DroviRecorderMac.xcodeproj"
SCHEME=DroviRecorderMac

if [[ ! -d "$PROJECT" ]]; then
  echo "macOS project not found at $PROJECT" >&2
  exit 1
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "platform=macOS" \
  build
