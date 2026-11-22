<?php
declare(strict_types=1);

const APP_MAX_BODY = 16384;

function app_respond(int $status, array $body, array $headers = []): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    foreach ($headers as $k => $v) header("$k: $v");
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function app_clean($v, int $max = 4000): string {
    if (is_int($v) || is_float($v)) $v = (string)$v;
    if (!is_string($v)) return '';
    $v = preg_replace('/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $v) ?? '';
    $v = trim($v);
    return app_len($v) > $max ? app_substr($v, $max) : $v;
}
function app_len(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s); }
function app_substr(string $s, int $n): string { return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n); }

function app_log(array $cfg, array $event): void {
    // IDs, codes and reasons only. Never customer text, keys or signatures.
    @file_put_contents(($cfg['DATA_DIR'] ?? sys_get_temp_dir()) . '/app.log', gmdate('c') . ' ' . json_encode($event, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

/** REQ-YYYYMMDD-NNNNNN (digits only, so Lead's threadId thr_<digits> is derivable). */
function app_request_id(): string { return 'REQ-' . gmdate('Ymd') . '-' . str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT); }
function app_thread_id(string $requestId): string { return 'thr_' . preg_replace('/\D/', '', $requestId); }
function app_valid_request_id(string $id): bool { return (bool)preg_match('/^REQ-\d{8}-\d{6}$/', $id); }

/** Reads a JSON object body with the usual guards. Returns [array|null, errorResponse|null]. */
function app_read_json(array $cfg, bool $checkOrigin = true): array {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return [null, [405, ['ok' => false, 'error' => 'method_not_allowed']]];
    if ($checkOrigin) {
        $allowed = array_filter(array_map('trim', explode(',', (string)($cfg['ALLOWED_ORIGINS'] ?? ''))));
        if ($allowed && !in_array($_SERVER['HTTP_ORIGIN'] ?? '', $allowed, true)) return [null, [403, ['ok' => false, 'error' => 'forbidden_origin']]];
    }
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) return [null, [415, ['ok' => false, 'error' => 'json_required']]];
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > APP_MAX_BODY) return [null, [413, ['ok' => false, 'error' => 'too_large']]];
    $raw = (string)file_get_contents('php://input', false, null, 0, APP_MAX_BODY + 1);
    if (strlen($raw) > APP_MAX_BODY) return [null, [413, ['ok' => false, 'error' => 'too_large']]];
    $body = json_decode($raw, true);
    if (!is_array($body) || (array_is_list($body) && $body !== [])) return [null, [400, ['ok' => false, 'error' => 'bad_json']]];
    $GLOBALS['APP_RAW_BODY'] = $raw;
    return [$body, null];
}

/** Sliding-window limiter: one flock'ed JSON file per (bucket, IP hash). */
function app_rate_limit(array $cfg, string $bucket, string $ip, int $max, int $window): array {
    $file = $cfg['DATA_DIR'] . '/ratelimit/' . hash('sha256', "$bucket:$ip") . '.json';
    $fh = @fopen($file, 'c+');
    if (!$fh) return [true, 0];
    try {
        flock($fh, LOCK_EX);
        $now = time();
        $hits = json_decode(stream_get_contents($fh) ?: '[]', true) ?: [];
        $hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - $window));
        $ok = count($hits) < $max;
        if ($ok) $hits[] = $now;
        ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($hits)); fflush($fh);
        return [$ok, $ok ? 0 : max(1, $hits[0] + $window - $now)];
    } finally { flock($fh, LOCK_UN); fclose($fh); }
}

function app_client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? 'unknown'; }

function app_write_json(string $file, array $data): bool {
    $ok = @file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
    if ($ok) @chmod($file, 0600);
    return $ok;
}

/** HMAC for Lead -> site calls: hex(HMAC-SHA256(secret, timestamp + "." + rawBody)), 5-minute window. */
function app_verify_lead_signature(array $cfg, string $raw): ?string {
    $secret = (string)($cfg['LEAD_HMAC_SECRET'] ?? '');
    if (strlen($secret) < 32) return 'lead_secret_not_configured';
    $ts = (string)($_SERVER['HTTP_X_INTAKE_TIMESTAMP'] ?? '');
    $sig = strtolower((string)($_SERVER['HTTP_X_INTAKE_SIGNATURE'] ?? ''));
    if (!ctype_digit($ts) || abs(time() - (int)$ts) > 300) return 'stale_or_missing_timestamp';
    if (!hash_equals(hash_hmac('sha256', $ts . '.' . $raw, $secret), $sig)) return 'bad_signature';
    return null;
}

function app_http_post_json(string $url, array $headers, array $json, int $timeout = 15): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json', 'Accept: application/json'], $headers),
        CURLOPT_POSTFIELDS => json_encode($json, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = $raw === false ? curl_error($ch) : '';
    curl_close($ch);
    return [$code, $raw === false ? null : $raw, $err];
}
