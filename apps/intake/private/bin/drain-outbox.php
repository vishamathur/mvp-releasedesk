<?php
// cPanel Cron Job (every 5 min):  php ~/intake-private/bin/drain-outbox.php
// Retries queued Site -> Lead messages; after 50 attempts moves them to data/dead/.
declare(strict_types=1);
require __DIR__ . '/../bootstrap.php';
$cfg = app_config();
if (!$cfg) { fwrite(STDERR, "not configured\n"); exit(1); }
@mkdir($cfg['DATA_DIR'] . '/dead', 0700, true);
$n = 0;
foreach (glob($cfg['DATA_DIR'] . '/outbox/*.json') ?: [] as $f) {
    $item = json_decode((string)file_get_contents($f), true);
    if (($item['attempts'] ?? 0) >= 50) { rename($f, $cfg['DATA_DIR'] . '/dead/' . basename($f)); continue; }
    $r = delivery_attempt($cfg, $f); $n++;
    echo basename($f), ' ', $r, "\n";
}
echo "processed $n\n";
