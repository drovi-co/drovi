#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

output_dir="${1:-backups/imperium}"
timestamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$output_dir"
output_file="$output_dir/imperium-$timestamp.dump"

pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$output_file"
echo "Backup written to $output_file"
