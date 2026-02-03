#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install via 'brew install xcodegen'." >&2
  exit 1
fi

pushd /Users/jeremyscatigna/project-memory/apps/macos/DroviRecorder >/dev/null
xcodegen generate --spec project.yml
popd >/dev/null

pushd /Users/jeremyscatigna/project-memory/apps/ios/DroviRecorder >/dev/null
xcodegen generate --spec project.yml
popd >/dev/null

echo "Xcode projects generated."
