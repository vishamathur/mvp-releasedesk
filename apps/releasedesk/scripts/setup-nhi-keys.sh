#!/usr/bin/env bash
# Run: bash apps/releasedesk/scripts/setup-nhi-keys.sh && npm run desk
# Interactive NHI key setup for local Desk (:3002). Never commits secrets.
# Lean demo: Lead + Security + Coding is enough; leave others blank to keep MOCK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

echo "Writing exclusive NHI slots to: $ENV_FILE"
echo "(input is hidden — paste each key and press Enter; blank = leave empty/MOCK)"
echo

read -r -s -p "RELEASEDESK_GROK_API_KEY_LEAD: " LEAD
echo
read -r -s -p "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST: " CHANGE_ANALYST
echo
read -r -s -p "RELEASEDESK_GROK_API_KEY_STANDARDS: " STANDARDS
echo
read -r -s -p "RELEASEDESK_GROK_API_KEY_SECURITY: " SECURITY
echo
read -r -s -p "RELEASEDESK_GROK_API_KEY_BUILDER: " BUILDER
echo
read -r -s -p "RELEASEDESK_CURSOR_API_KEY_CODING: " CODING
echo

umask 077
cat > "$ENV_FILE" <<ENV
RELEASEDESK_GROK_API_KEY_LEAD=${LEAD}
RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST=${CHANGE_ANALYST}
RELEASEDESK_GROK_API_KEY_STANDARDS=${STANDARDS}
RELEASEDESK_GROK_API_KEY_SECURITY=${SECURITY}
RELEASEDESK_GROK_API_KEY_BUILDER=${BUILDER}
RELEASEDESK_CURSOR_API_KEY_CODING=${CODING}
RELEASEDESK_CLOUD_CLIENT=real
ENV
chmod 600 "$ENV_FILE"

echo "Done. $ENV_FILE written (mode 600). Restart Desk: npm run desk"
