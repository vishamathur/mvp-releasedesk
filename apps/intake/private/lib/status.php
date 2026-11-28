<?php
declare(strict_types=1);
/*
 * Public status lifecycle. Only Release Desk Lead moves it (HMAC-signed lead-update).
 * received -> estimating -> finance-approval -> security -> build -> release -> done | rejected
 */
const STATUS_FLOW = ['received', 'estimating', 'finance-approval', 'security', 'build', 'release', 'done'];
const STATUS_TERMINAL = ['done', 'rejected'];
const STATUS_LABELS = [
    'received' => 'Received by Release Desk Lead',
    'estimating' => 'Scoping and estimating',
    'finance-approval' => 'Waiting for finance approval (human decision)',
    'security' => 'Security and compliance review (human decision)',
    'build' => 'In build and test',
    'release' => 'Waiting for release approval (human decision)',
    'done' => 'Released',
    'rejected' => 'Closed - not going ahead',
];
/** PID stage (Lead's pid.state) -> public status. */
const STATUS_FROM_STAGE = [
    'intake' => 'received', 'customer-onboarding' => 'estimating', 'discovery' => 'estimating', 'scope' => 'estimating',
    'proposal' => 'estimating', 'estimation' => 'estimating', 'finance-approval' => 'finance-approval',
    'security-compliance-approval' => 'security', 'build' => 'build', 'test-gate' => 'build', 'release-gate' => 'release', 'done' => 'done',
];
const STATUS_NEXT_GATE_OWNER = ['proposal' => 'change-analyst', 'finance-approval' => 'change-analyst', 'security-compliance-approval' => 'security', 'release-gate' => 'builder', 'none' => null];

function status_file(array $cfg, string $id): string { return $cfg['DATA_DIR'] . "/status/$id.json"; }

function status_create(array $cfg, string $requestId, string $pid): string {
    $token = bin2hex(random_bytes(16));
    app_write_json(status_file($cfg, $requestId), [
        'requestId' => $requestId, 'pid' => $pid, 'tokenHash' => hash('sha256', $token), 'status' => 'received',
        'nextGate' => null, 'quote' => null, 'updateIds' => [],
        'history' => [['at' => gmdate('Y-m-d\TH:i:s\Z'), 'status' => 'received', 'from' => 'site', 'message' => 'Request received and sent to Release Desk Lead.']],
    ]);
    return $token;
}

function status_allowed_transition(string $from, string $to): bool {
    if (in_array($from, STATUS_TERMINAL, true)) return false;
    if ($to === 'rejected' || $to === $from) return true;
    $fi = array_search($from, STATUS_FLOW, true); $ti = array_search($to, STATUS_FLOW, true);
    if ($fi === false || $ti === false) return false;
    if ($ti > $fi) return true;
    return in_array($to, ['security', 'build'], true) && $fi >= array_search('build', STATUS_FLOW, true); // remediation loop
}

/** Pure validator for a Lead update body. Returns [errors[], cleanUpdate]. */
function status_validate_update(array $b): array {
    $e = [];
    $rid = (string)($b['requestId'] ?? ''); if (!app_valid_request_id($rid)) $e[] = 'requestId';
    $uid = (string)($b['updateId'] ?? ''); if (!preg_match('/^[A-Za-z0-9._:-]{4,64}$/', $uid)) $e[] = 'updateId';
    if (($b['from'] ?? '') !== 'lead') $e[] = 'from';
    $status = $b['publicStatus'] ?? (STATUS_FROM_STAGE[$b['stage'] ?? ''] ?? null);
    if (!isset(STATUS_LABELS[$status ?? ''])) $e[] = 'publicStatus';
    $msg = app_clean($b['message'] ?? '', 1001); if ($msg === '' || app_len($msg) > 1000) $e[] = 'message';
    $gate = null;
    if (isset($b['nextGate'])) {
        $g = $b['nextGate']['gate'] ?? '';
        if (!array_key_exists($g, STATUS_NEXT_GATE_OWNER) || ($b['nextGate']['owner'] ?? null) !== STATUS_NEXT_GATE_OWNER[$g]) $e[] = 'nextGate';
        else $gate = ['gate' => $g, 'owner' => STATUS_NEXT_GATE_OWNER[$g]];
    }
    if (preg_match('/\b(approved|approval granted)\b/i', $msg) && !preg_match('/\b(by|from) [A-Z][a-z]+/', $msg)) $e[] = 'message: an approval must name the human who decided';
    $quote = null;
    if (isset($b['quote'])) {
        $q = $b['quote'];
        $bands = $q['budgetBandsInr'] ?? null;
        if (!is_int($q['totalInr'] ?? null) || $q['totalInr'] < 0 || !is_array($bands) || !is_int($bands['low'] ?? null) || !is_int($bands['high'] ?? null)) $e[] = 'quote';
        else {
            $lines = [];
            foreach (array_slice((array)($q['lines'] ?? []), 0, 12) as $l) $lines[] = ['serviceId' => app_clean($l['serviceId'] ?? '', 20), 'name' => app_clean($l['name'] ?? '', 80), 'qty' => (int)($l['qty'] ?? 0), 'lineTotalInr' => (int)($l['lineTotalInr'] ?? 0)];
            $quote = ['totalInr' => $q['totalInr'], 'budgetBandsInr' => ['low' => $bands['low'], 'expected' => (int)($bands['expected'] ?? $q['totalInr']), 'high' => $bands['high']],
                'lines' => $lines, 'note' => 'Indicative, EXAMPLE catalogue prices, excl. GST. Not an offer until finance approval by a person.'];
        }
    }
    return [$e, ['requestId' => $rid, 'updateId' => $uid, 'status' => $status, 'message' => $msg, 'nextGate' => $gate, 'quote' => $quote]];
}

/** POST api/lead-update.php (Lead only, HMAC). */
function api_lead_update(array $cfg): void {
    [$body, $err] = app_read_json($cfg, false);
    if ($err) { app_respond(...$err); return; }
    if ($why = app_verify_lead_signature($cfg, $GLOBALS['APP_RAW_BODY'])) { app_log($cfg, ['event' => 'lead_update_auth_failed', 'why' => $why]); app_respond(401, ['ok' => false, 'error' => 'unauthorized']); return; }
    [$e, $u] = status_validate_update($body);
    if ($e) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => $e]); return; }
    $file = status_file($cfg, $u['requestId']);
    $fh = @fopen($file, 'c+');
    if (!$fh || !filesize($file)) { if ($fh) fclose($fh); app_respond(404, ['ok' => false, 'error' => 'unknown_request']); return; }
    try {
        flock($fh, LOCK_EX);
        $s = json_decode(stream_get_contents($fh), true);
        if (in_array($u['updateId'], $s['updateIds'], true)) { app_respond(200, ['ok' => true, 'duplicate' => true, 'status' => $s['status']]); return; }
        if (!status_allowed_transition($s['status'], $u['status'])) { app_respond(409, ['ok' => false, 'error' => 'bad_transition', 'from' => $s['status'], 'to' => $u['status']]); return; }
        $s['status'] = $u['status'];
        $s['nextGate'] = $u['nextGate'] ?? $s['nextGate'];
        if ($u['quote']) $s['quote'] = $u['quote'];
        $s['updateIds'] = array_slice(array_merge($s['updateIds'], [$u['updateId']]), -100);
        $s['history'][] = ['at' => gmdate('Y-m-d\TH:i:s\Z'), 'status' => $u['status'], 'from' => 'lead', 'message' => $u['message']];
        ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)); fflush($fh);
    } finally { flock($fh, LOCK_UN); fclose($fh); }
    app_log($cfg, ['event' => 'lead_update', 'requestId' => $u['requestId'], 'status' => $u['status']]);
    app_respond(200, ['ok' => true, 'status' => $u['status']]);
}

function status_load_for_visitor(array $cfg, string $ref, string $token): ?array {
    if (!app_valid_request_id($ref) || !preg_match('/^[a-f0-9]{32}$/', $token)) return null;
    $s = json_decode((string)@file_get_contents(status_file($cfg, $ref)), true);
    if (!is_array($s) || !hash_equals($s['tokenHash'], hash('sha256', $token))) return null;
    return $s;
}

function status_view(array $s): array {
    $steps = [];
    $cur = array_search($s['status'], STATUS_FLOW, true);
    foreach (STATUS_FLOW as $i => $st) $steps[] = ['status' => $st, 'label' => STATUS_LABELS[$st], 'state' => $s['status'] === 'rejected' ? 'n/a' : ($cur === false ? 'todo' : ($i < $cur ? 'done' : ($i === $cur ? 'current' : 'todo')))];
    return ['ok' => true, 'requestId' => $s['requestId'], 'pid' => $s['pid'], 'status' => $s['status'], 'statusLabel' => STATUS_LABELS[$s['status']],
        'steps' => $steps, 'nextGate' => $s['nextGate'], 'quote' => $s['quote'], 'messages' => array_slice($s['history'], -30)];
}

/** POST {ref, token} reads status. POST {ref, token, message} sends a visitor message. The token is never read from the query string. */
function api_status(array $cfg): void {
    $ip = app_client_ip();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') { app_respond(405, ['ok' => false, 'error' => 'method_not_allowed']); return; }
    [$body, $err] = app_read_json($cfg);
    if ($err) { app_respond(...$err); return; }
    $hasMessage = array_key_exists('message', $body) && $body['message'] !== null;
    if (!$hasMessage) {
        [$ok, $retry] = app_rate_limit($cfg, 'status', $ip, 60, 600);
        if (!$ok) { app_respond(429, ['ok' => false, 'error' => 'rate_limited'], ['Retry-After' => (string)$retry]); return; }
        $s = status_load_for_visitor($cfg, app_clean($body['ref'] ?? '', 30), app_clean($body['token'] ?? '', 40));
        if (!$s) { app_respond(404, ['ok' => false, 'error' => 'not_found']); return; }
        app_respond(200, status_view($s));
        return;
    }
    [$ok, $retry] = app_rate_limit($cfg, 'visitor-msg', $ip, 10, 600);
    if (!$ok) { app_respond(429, ['ok' => false, 'error' => 'rate_limited'], ['Retry-After' => (string)$retry]); return; }
    $s = status_load_for_visitor($cfg, app_clean($body['ref'] ?? '', 30), app_clean($body['token'] ?? '', 40));
    if (!$s) { app_respond(404, ['ok' => false, 'error' => 'not_found']); return; }
    $msg = app_clean($body['message'] ?? '', 2001);
    if (app_len($msg) < 2 || app_len($msg) > 2000) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => ['message']]); return; }
    if (in_array($s['status'], STATUS_TERMINAL, true)) { app_respond(409, ['ok' => false, 'error' => 'closed']); return; }
    $payload = ['v' => 1, 'kind' => 'visitor-message', 'requestId' => $s['requestId'], 'pid' => $s['pid'], 'to' => 'lead', 'untrusted' => true,
        'sentAt' => gmdate('Y-m-d\TH:i:s\Z'), 'message' => $msg, 'currentPublicStatus' => $s['status']];
    $delivery = delivery_send($cfg, 'visitor-message', $s['requestId'], $payload);
    app_log($cfg, ['event' => 'visitor_message', 'requestId' => $s['requestId'], 'delivery' => $delivery]);
    app_respond(200, ['ok' => true, 'message' => 'Sent to Release Desk Lead. Replies appear on this status page.']);
}
