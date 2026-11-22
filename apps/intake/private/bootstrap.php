<?php
// Loaded by every public endpoint. Lives outside public_html.
declare(strict_types=1);
foreach (['common', 'grok', 'catalogue', 'finance', 'intake', 'status', 'delivery', 'chat'] as $m) require_once __DIR__ . "/lib/$m.php";

function app_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = getenv('INTAKE_CONFIG') ?: (__DIR__ . '/intake-config.php');
    $cfg = is_file($file) ? (require $file) : null;
    if (!is_array($cfg)) return $cfg = [];
    foreach (['GROK_API_KEY', 'LEAD_HMAC_SECRET', 'LEAD_WEBHOOK_KEY'] as $k) if (getenv($k)) $cfg[$k] = getenv($k);
    if (empty($cfg['GROK_API_KEY']) && getenv('XAI_API_KEY')) $cfg['GROK_API_KEY'] = getenv('XAI_API_KEY');
    $cfg['DATA_DIR'] = rtrim($cfg['DATA_DIR'] ?? (__DIR__ . '/data'), '/');
    $cfg['CATALOGUE_FILE'] = $cfg['CATALOGUE_FILE'] ?? (__DIR__ . '/catalogue.example.json');
    foreach (['', '/submissions', '/status', '/outbox', '/ratelimit', '/sent'] as $d) if (!is_dir($cfg['DATA_DIR'] . $d)) @mkdir($cfg['DATA_DIR'] . $d, 0700, true);
    return $cfg;
}

function app_run(string $handler): void {
    $cfg = app_config();
    if (!$cfg) { app_respond(503, ['ok' => false, 'error' => 'not_configured', 'message' => 'This service is not available yet.']); return; }
    try { $handler($cfg); }
    catch (Throwable $e) {
        app_log($cfg, ['event' => 'unhandled', 'handler' => $handler, 'reason' => substr($e->getMessage(), 0, 160)]);
        app_respond(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Something went wrong. Please try again later.']);
    }
}
