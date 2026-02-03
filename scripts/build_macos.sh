#!/usr/bin/env bash
set -euo pipefail

PROJECT=/Users/jeremyscatigna/project-memory/apps/macos/DroviRecorder/DroviRecorderMac.xcodeproj
SCHEME=DroviRecorderMac

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "platform=macOS" \
  build
