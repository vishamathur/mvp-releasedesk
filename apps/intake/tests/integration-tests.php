<?php
// Endpoint tests against php -S. Grok is not called. A missing key is an error.
$PRIV = getenv('PRIVATE_DIR');
$base = getenv('BASE'); $data = getenv('DATA_DIR'); $secret = getenv('TEST_HMAC');
$O = 'https://intake.vishalmathur.org';
function req(string $method, string $url, $body = null, array $hdr = [], bool $raw = false): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_HTTPHEADER => $hdr]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $raw ? $body : json_encode($body));
    $r = curl_exec($ch); $c = curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch);
    return [$c, json_decode(substr($r, $hs), true), substr($r, 0, $hs) . substr($r, $hs)];
}
function signed(string $url, array $body, string $secret, ?int $ts = null): array {
    $raw = json_encode($body); $ts = (string)($ts ?? time());
    return req('POST', $url, $raw, ['Content-Type: application/json', "X-Intake-Timestamp: $ts", 'X-Intake-Signature: ' . hash_hmac('sha256', "$ts.$raw", $secret)], true);
}
$J = ['Content-Type: application/json', "Origin: $O"];
$er = ['route' => 'er', 'pid' => 'PID-ER', 'catalogueOptionId' => 'ER-KYC-LABELS', 'addOns' => [],
    'contactName' => 'Jane Doe', 'email' => 'jane@example.com', 'company' => 'Acme', 'customerId' => 'cust_1042', 'projectRef' => 'PRJ-ONB-7',
    'changeType' => 'enhancement', 'title' => 'Rename two labels', 'description' => 'Rename two labels on the onboarding screen for clarity.', 'urgency' => 'standard',
    'artifactLinks' => ['https://example.com/shot.png'], 'website' => '', 'consent' => true];
$R = [];
function t(string $n, callable $f) { global $R; try { $f(); $R[] = "PASS  $n"; } catch (Throwable $e) { $R[] = "FAIL  $n  " . $e->getMessage(); } }
function ok($c, string $m = 'assert') { if (!$c) throw new Exception($m); }

t('catalogue endpoint returns EXAMPLE services, enhancements and new applications', function () use ($base) {
    [$c, $j] = req('GET', "$base/api/catalogue.php");
    ok($c === 200 && count($j['services']) === 13 && str_contains($j['label'], 'EXAMPLE DATA - illustrative prices only'), "c=$c");
    ok(isset($j['enhancements'][0]['options'][0]['billOfMaterials']) && isset($j['newApplications'][0]['billOfMaterials']), 'shape');
    $ids = [];
    foreach ($j['enhancements'] as $app) foreach ($app['options'] as $opt) $ids[] = $opt['id'];
    foreach ($j['newApplications'] as $app) { $ids[] = $app['id']; foreach ($app['addOns'] as $add) $ids[] = $add['id']; }
    ok(in_array('ER-KYC-LABELS', $ids, true) && in_array('NC-KYC', $ids, true) && count($ids) === count(array_unique($ids)), 'ids');
});
t('chat without GROK_API_KEY is a configuration error', function () use ($base, $J) {
    [$c, $j] = req('POST', "$base/api/chat.php", ['route' => 'er', 'messages' => [['role' => 'user', 'content' => 'Rename two labels']]], $J);
    ok($c === 503 && ($j['error'] ?? '') === 'grok_unavailable' && str_contains($j['message'] ?? '', 'GROK_API_KEY is not set'), json_encode($j));
    ok(!isset($j['reply']), 'no invented reply');
});
t('intake with a valid catalogue option is priced from the bill of materials', function () use ($base, $J, $er, $data) {
    $before = count(glob("$data/submissions/REQ-*.json") ?: []);
    [$c, $j] = req('POST', "$base/api/intake.php", $er, $J);
    ok($c === 200 && ($j['ok'] ?? false) === true && isset($j['referenceId']), json_encode($j));
    $card = json_decode((string)file_get_contents("$data/submissions/{$j['referenceId']}.json"), true);
    ok($card['catalogueOptionId'] === 'ER-KYC-LABELS' && $card['pid'] === 'PID-ER', json_encode([$card['catalogueOptionId'] ?? null, $card['pid'] ?? null]));
    ok($card['finance']['source'] === 'catalogue-option' && $card['finance']['estimate']['totalInr'] === 187000, json_encode($card['finance']['source'] ?? $card['finance']));
    ok(in_array('catalogue:ER-KYC-LABELS@example-2026-11', $card['finance']['estimate']['artifactRefs'], true), json_encode($card['finance']['estimate']['artifactRefs'] ?? []));
    ok(count(glob("$data/submissions/REQ-*.json") ?: []) === $before + 1, 'card stored');
});
t('showcase options are priced and can be submitted', function () use ($base, $J, $er, $data) {
    [$c, $j] = req('GET', "$base/api/catalogue.php");
    $found = [];
    foreach ($j['enhancements'] as $app) foreach ($app['options'] as $opt) $found[$opt['id']] = $opt;
    foreach ($j['newApplications'] as $app) $found[$app['id']] = $app;
    ok(($found['SX-HELPDESK-BOT']['exampleEstimate']['totalInr'] ?? 0) === 1286850, 'helpdesk');
    ok(($found['SX-LIVE-REVIEW']['exampleEstimate']['totalInr'] ?? 0) === 385000, 'review');
    ok(($found['SX-LANDING-PAGE']['exampleEstimate']['totalInr'] ?? 0) === 836000, 'landing');
    ok($found['SX-HELPDESK-BOT']['showcase45'] === true && $found['SX-LIVE-REVIEW']['showcase45'] === true && $found['SX-LANDING-PAGE']['showcase45'] === true, 'badge');
    $before = count(glob("$data/submissions/REQ-*.json") ?: []);
    [$c, $j] = req('POST', "$base/api/intake.php", ['catalogueOptionId' => 'SX-HELPDESK-BOT'] + $er, $J);
    ok($c === 200 && ($j['ok'] ?? false) === true, json_encode($j));
    $card = json_decode((string)file_get_contents("$data/submissions/{$j['referenceId']}.json"), true);
    ok($card['catalogueOptionId'] === 'SX-HELPDESK-BOT' && $card['finance']['estimate']['totalInr'] === 1286850, json_encode($card['finance']['estimate']['totalInr'] ?? null));
    $nc = ['route' => 'new_customer', 'pid' => 'PID-NC', 'catalogueOptionId' => 'SX-LANDING-PAGE', 'addOns' => [],
        'contactName' => 'Jane Doe', 'email' => 'jane@example.com', 'company' => 'Acme', 'legalName' => 'Acme Pvt Ltd',
        'jurisdiction' => 'India', 'intendedProduct' => 'Lending', 'sponsor' => 'R. Rao, CFO',
        'title' => 'Marketing landing page', 'description' => 'A marketing landing page for a new product launch.',
        'urgency' => 'standard', 'website' => '', 'consent' => true];
    [$c, $j] = req('POST', "$base/api/intake.php", $nc, $J);
    ok($c === 200 && ($j['ok'] ?? false) === true, json_encode($j));
    $card = json_decode((string)file_get_contents("$data/submissions/{$j['referenceId']}.json"), true);
    ok($card['pid'] === 'PID-NC' && $card['finance']['estimate']['totalInr'] === 836000, json_encode($card['finance']['estimate']['totalInr'] ?? null));
    [$c, $j] = req('POST', "$base/api/intake.php", ['catalogueOptionId' => 'SX-LIVE-REVIEW'] + $er, $J);
    ok($c === 200, json_encode($j));
    $card = json_decode((string)file_get_contents("$data/submissions/{$j['referenceId']}.json"), true);
    ok($card['finance']['source'] === 'catalogue-option' && $card['finance']['estimate']['totalInr'] === 385000, json_encode($card['finance']['estimate']['totalInr'] ?? null));
    ok(count(glob("$data/submissions/REQ-*.json") ?: []) === $before + 3, 'three cards');
});
t('intake with an invalid catalogue option is rejected', function () use ($base, $J, $er, $data) {
    $before = count(glob("$data/submissions/REQ-*.json") ?: []);
    [$c, $j] = req('POST', "$base/api/intake.php", ['catalogueOptionId' => 'NO-SUCH'] + $er, $J);
    ok($c === 400 && in_array('catalogueOptionId', $j['fields'] ?? [], true), json_encode($j));
    [$c, $j] = req('POST', "$base/api/intake.php", ['catalogueOptionId' => 'NC-KYC', 'pid' => 'PID-ER'] + $er, $J);
    ok($c === 400 && in_array('pid', $j['fields'] ?? [], true), json_encode($j));
    ok(count(glob("$data/submissions/REQ-*.json") ?: []) === $before, 'no card stored');
});
t('validation, honeypot, origin, content-type, size', function () use ($base, $J, $er, $data) {
    [$c, $j] = req('POST', "$base/api/intake.php", ['customerId' => '', 'consent' => false] + $er, $J); ok($c === 400 && in_array('customerId', $j['fields']) && in_array('consent', $j['fields']), 'val');
    [$c, $j] = req('POST', "$base/api/intake.php", ['customerId' => 'CUST-1042'] + $er, $J); ok($c === 400 && in_array('customerId', $j['fields']), 'hyphenated customer id');
    $n = count(glob("$data/submissions/REQ-*.json") ?: []);
    [$c] = req('POST', "$base/api/intake.php", ['website' => 'x'] + $er, $J); ok($c === 200 && count(glob("$data/submissions/REQ-*.json") ?: []) === $n, 'honeypot');
    [$c] = req('POST', "$base/api/intake.php", $er, ['Content-Type: application/json', 'Origin: https://evil.example']); ok($c === 403, 'origin');
    [$c] = req('POST', "$base/api/intake.php", 'a=b', ['Content-Type: text/plain', "Origin: https://intake.vishalmathur.org"], true); ok($c === 415, 'ct');
    [$c] = req('POST', "$base/api/intake.php", ['description' => str_repeat('x', 20000)] + $er, $J); ok($c === 413, 'size');
});
t('lead-update and status use a seeded record, not a Grok result', function () use ($base, $secret, $data) {
    $requestId = 'REQ-20261122-000777';
    $token = '0123456789abcdef0123456789abcdef';
    if (!is_dir("$data/status")) mkdir("$data/status", 0700, true);
    file_put_contents("$data/status/$requestId.json", json_encode([
        'requestId' => $requestId, 'pid' => 'PID-ER', 'tokenHash' => hash('sha256', $token), 'status' => 'received',
        'nextGate' => null, 'quote' => null, 'updateIds' => [],
        'history' => [['at' => '2026-11-22T12:00:00Z', 'status' => 'received', 'from' => 'site', 'message' => 'Request received and sent to Release Desk Lead.']],
    ]));
    chmod("$data/status/$requestId.json", 0600);
    [$c, $j] = req('GET', "$base/api/status.php?ref=$requestId&token=$token");
    ok($c === 200 && $j['status'] === 'received', json_encode($j));
    [$c] = req('GET', "$base/api/status.php?ref=$requestId&token=" . str_repeat('0', 32)); ok($c === 404, 'token');
    $u = ['requestId' => $requestId, 'updateId' => 'lead-u-1', 'from' => 'lead', 'stage' => 'finance-approval', 'message' => 'Estimate ready. Finance review is next.',
        'nextGate' => ['gate' => 'finance-approval', 'owner' => 'change-analyst'], 'quote' => ['totalInr' => 187000, 'budgetBandsInr' => ['low' => 159000, 'expected' => 187000, 'high' => 234000],
        'lines' => [['serviceId' => 'SVC-UI-S', 'name' => 'UI change - small', 'qty' => 2, 'lineTotalInr' => 90000]]]];
    [$c] = req('POST', "$base/api/lead-update.php", $u, ['Content-Type: application/json']); ok($c === 401, "unsigned $c");
    [$c, $j] = signed("$base/api/lead-update.php", $u, $secret); ok($c === 200 && $j['status'] === 'finance-approval', json_encode($j));
    [$c, $j] = req('GET', "$base/api/status.php?ref=$requestId&token=$token");
    ok($j['status'] === 'finance-approval' && $j['quote']['totalInr'] === 187000 && $j['nextGate']['owner'] === 'change-analyst', json_encode($j));
});
t('finance-estimate endpoint uses explicit lines and does not call Grok', function () use ($base, $secret) {
    $b = ['requestId' => 'REQ-20261122-000001', 'pid' => 'PID-ER', 'text' => '', 'lines' => [['serviceId' => 'SVC-SEC', 'qty' => 1]], 'urgency' => 'expedited'];
    [$c] = req('POST', "$base/api/finance-estimate.php", $b, ['Content-Type: application/json']); ok($c === 401, 'unsigned');
    [$c, $j] = signed("$base/api/finance-estimate.php", $b, $secret);
    ok($c === 200 && $j['assessment']['estimate']['totalInr'] === 253000 && $j['assessment']['source'] === 'explicit-lines', json_encode($j['assessment']['estimate']['totalInr'] ?? $j));
});
t('finance-estimate without lines or a key is a configuration error', function () use ($base, $secret) {
    $b = ['pid' => 'PID-ER', 'text' => 'Rename two labels'];
    [$c, $j] = signed("$base/api/finance-estimate.php", $b, $secret);
    ok($c === 503 && str_contains($j['message'] ?? '', 'GROK_API_KEY is not set'), json_encode($j));
});
t('responses do not echo a key', function () use ($base, $J, $er) {
    [, , $all] = req('POST', "$base/api/chat.php", ['route' => 'er', 'messages' => [['role' => 'user', 'content' => 'Hello']]], $J);
    ok(!str_contains($all, 'test-key-not-real') && !str_contains($all, getenv('TEST_HMAC') ?: 'no-hmac'), 'leak');
});
foreach ($R as $r) echo $r, "\n";
$f = count(array_filter($R, fn($r) => str_starts_with($r, 'FAIL')));
echo '[integration] ', count($R) - $f, '/', count($R), " passed\n";
exit($f ? 1 : 0);
