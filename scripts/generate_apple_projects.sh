#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install via 'brew install xcodegen'." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

generate_project() {
  local project_dir="$1"
  local label="$2"

  if [[ ! -d "$project_dir" ]]; then
    echo "Skipping $label project generation: directory not found at $project_dir"
    return
  fi

  pushd "$project_dir" >/dev/null
  xcodegen generate --spec project.yml
  popd >/dev/null
}

generate_project "$REPO_ROOT/apps/macos/DroviRecorder" "macOS"
generate_project "$REPO_ROOT/apps/ios/DroviRecorder" "iOS"

echo "Xcode projects generated."
