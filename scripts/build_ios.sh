#!/usr/bin/env bash
set -euo pipefail

PROJECT=/Users/jeremyscatigna/project-memory/apps/ios/DroviRecorder/DroviRecorderiOS.xcodeproj
SCHEME=DroviRecorderiOS

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  build
