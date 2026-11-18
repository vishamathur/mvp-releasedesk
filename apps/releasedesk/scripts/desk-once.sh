#!/usr/bin/env bash
# Start Desk on :3001 only if nothing already owns the port.
# Duplicate `npm run desk` → listen EADDRINUSE; warn instead.
set -euo pipefail
PORT=3001
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

holders="$(pgrep -f 'next dev --port '"$PORT"'|next-server' 2>/dev/null || true)"
if curl -sS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${PORT}/control" 2>/dev/null; then
  echo "WARN: Desk already responding on :${PORT} (GET /control ok)."
  echo "Do not run a second \`npm run desk\` — that causes: listen EADDRINUSE :::3001"
  echo "Use the existing process/tmux session (e.g. tmux attach -t desk-control-verify)."
  if [[ -n "$holders" ]]; then
    echo "Holders: $(echo "$holders" | tr '\n' ' ')"
  fi
  exit 1
fi
if [[ -n "$holders" ]]; then
  echo "WARN: next/desk PIDs already running for :${PORT}: $(echo "$holders" | tr '\n' ' ')"
  echo "Kill them first (e.g. pkill -f 'next dev --port ${PORT}') or reuse that process."
  echo "A second start will fail with EADDRINUSE."
  exit 1
fi

exec npm run dev -w @releasedesk/ui
