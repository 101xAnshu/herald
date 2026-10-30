#!/usr/bin/env bash
set -euo pipefail

url="${1:?url required}"
timeout="${2:-120}"
started=$(date +%s)

while true; do
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "ready: $url"
    exit 0
  fi

  if (( $(date +%s) - started > timeout )); then
    echo "timed out waiting for $url" >&2
    exit 1
  fi

  sleep 2
done
