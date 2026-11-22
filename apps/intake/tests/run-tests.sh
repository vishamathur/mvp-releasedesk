#!/usr/bin/env bash
# Unit + integration tests. xAI is mocked; no real key is used or needed.
set -u
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); mkdir -p "$TMP/private"
cp -r private/. "$TMP/private/"
export MOCK_LOG="$TMP/mock.log"; : > "$MOCK_LOG"
export TEST_HMAC=$(php -r 'echo bin2hex(random_bytes(32));')
cat > "$TMP/private/intake-config.php" <<CFG
<?php return ['GROK_API_KEY'=>'test-key-not-real','GROK_BASE_URL'=>'http://127.0.0.1:9921/v1','GROK_MODEL'=>'grok-4.3',
'ALLOWED_ORIGINS'=>'https://intake.vishalmathur.org','PUBLIC_HOST'=>'intake.vishalmathur.org','RATE_LIMIT_MAX'=>12,'RATE_LIMIT_WINDOW_SEC'=>600,
'CHAT_RATE_LIMIT_MAX'=>30,'RETENTION_DAYS'=>30,'CATALOGUE_FILE'=>'$TMP/private/catalogue.example.json','DATA_DIR'=>'$TMP/data',
'LEAD_DELIVERY'=>'queue','LEAD_HMAC_SECRET'=>'$TEST_HMAC'];
CFG
cp "$TMP/private/intake-config.php" "$TMP/unit-config.php"; sed -i "s#'$TMP/data'#'$TMP/unitdata'#" "$TMP/unit-config.php"
UNIT_CONFIG="$TMP/unit-config.php" PRIVATE_DIR="$TMP/private" php tests/unit-tests.php; R1=$?
php -S 127.0.0.1:9921 tests/mock-xai.php >/dev/null 2>&1 & M=$!
INTAKE_PRIVATE_DIR="$TMP/private" php -S 127.0.0.1:9920 -t public >/dev/null 2>&1 & S=$!
sleep 0.8
BASE=http://127.0.0.1:9920 DATA_DIR="$TMP/data" PRIVATE_DIR="$TMP/private" php tests/integration-tests.php; R2=$?
kill $S $M 2>/dev/null; rm -rf "$TMP"
exit $(( R1 || R2 ))
