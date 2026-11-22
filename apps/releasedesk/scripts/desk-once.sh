#!/usr/bin/env bash
# Start Desk on $PORT (default 3002) only if nothing already owns that port.
# Duplicate start → listen EADDRINUSE; warn instead.
# Override: PORT=3001 npm run desk
set -euo pipefail
PORT="${PORT:-3002}"
export PORT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

holders="$(pgrep -f "next dev --port ${PORT}" 2>/dev/null || true)"
if curl -sS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${PORT}/handoff" 2>/dev/null; then
  echo "WARN: Desk already responding on :${PORT} (GET /handoff ok)."
  echo "Do not run a second \`npm run desk\` on the same port — that causes: listen EADDRINUSE ::: ${PORT}"
  echo "Use the existing process/tmux session, or set PORT to a free port (e.g. PORT=3003 npm run desk)."
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

echo "Starting Desk on :${PORT} …"
exec npm run dev -w @releasedesk/ui
