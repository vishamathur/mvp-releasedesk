#!/usr/bin/env bash
# Writes the single app Grok key for local Desk (:3002). Never commits secrets.
# Does not prompt for per-bot keys. Does not set RELEASEDESK_CLOUD_CLIENT=real.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

echo "Writing XAI_API_KEY to: $ENV_FILE"
echo "(input is hidden — paste the key and press Enter; blank leaves it empty)"
echo

read -r -s -p "XAI_API_KEY: " APP_KEY
echo

umask 077
cat > "$ENV_FILE" <<ENV
XAI_API_KEY=${APP_KEY}
# Per-bot RELEASEDESK_GROK_API_KEY_* and RELEASEDESK_CURSOR_API_KEY_* are ignored.
# Do not set RELEASEDESK_CLOUD_CLIENT=real. Builder launches Cursor from the Grok Bot app.
ENV

echo "Wrote $ENV_FILE (value not printed)."
echo "Start Desk with: npm run desk"
