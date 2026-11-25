<?php
// Pure unit tests: catalogue math, policy, validation, handoff shape, status lifecycle.
declare(strict_types=1);
$priv = getenv('PRIVATE_DIR') ?: __DIR__ . '/../intake-private';
putenv('INTAKE_CONFIG=' . getenv('UNIT_CONFIG'));
require $priv . '/bootstrap.php';
$cfg = app_config();
$R = [];
function t(string $n, callable $f) { global $R; try { $f(); $R[] = "PASS  $n"; } catch (Throwable $e) { $R[] = "FAIL  $n  " . $e->getMessage(); } }
function ok($c, string $m = 'assert') { if (!$c) throw new Exception($m); }

t('grok body: guidelines, hashed safety id, no stop or n', function () {
    $body = grok_chat_body(
        ['GROK_MODEL' => 'grok-4.20-0309-non-reasoning'],
        'system',
        'visitor text',
        'intake_chat',
        ['type' => 'object', 'required' => []],
        'REQ-20261122-000123'
    );
    ok($body['guidelines'] === grok_guidelines(), json_encode($body['guidelines']));
    ok($body['safety_identifier'] === hash('sha256', 'REQ-20261122-000123'), 'hash');
    ok(!isset($body['stop']) && !isset($body['n']), 'no stop or n');
    ok(!str_contains($body['safety_identifier'], 'REQ-'), 'opaque');
    $threw = false;
    try { grok_chat_body(['GROK_MODEL' => 'grok-4.20-multi-agent'], 's', 'u', 'n', ['type' => 'object'], 'REQ-1'); }
    catch (RuntimeException $e) { $threw = str_contains($e->getMessage(), 'guidelines'); }
    ok($threw, 'multi-agent');
    $empty = false;
    try { grok_safety_identifier('   '); } catch (RuntimeException $e) { $empty = true; }
    ok($empty, 'empty id');
    $noModel = false;
    try { grok_chat_body([], 's', 'u', 'n', ['type' => 'object'], 'REQ-1'); }
    catch (RuntimeException $e) { $noModel = str_contains($e->getMessage(), 'GROK_MODEL is not set'); }
    ok($noModel, 'model');
});
t('catalogue: EXAMPLE services load and validate', function () use ($cfg) {
    $c = catalogue_load($cfg);
    ok(count($c['byId']) === 13 && isset($c['byId']['SVC-WEB']) && isset($c['byId']['SVC-AI']), 'count');
    ok(str_contains($c['label'], 'EXAMPLE DATA - illustrative prices only'), 'label');
    ok(isset($c['optionById']['ER-KYC-LABELS']) && isset($c['optionById']['NC-KYC']), 'options');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['enhancements'][0]['options'][0]['billOfMaterials'][0]['serviceId'] = 'SVC-NOPE';
    $badService = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $badService = str_contains($e->getMessage(), 'catalogue_unknown_service'); }
    ok($badService, 'unknown service');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['enhancements'][0]['options'][0]['billOfMaterials'][0]['qty'] = 0;
    $badQty = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $badQty = str_contains($e->getMessage(), 'catalogue_bad_qty'); }
    ok($badQty, 'qty');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['newApplications'][0]['id'] = 'SVC-KYC';
    $dup = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $dup = str_contains($e->getMessage(), 'catalogue_duplicate_id'); }
    ok($dup, 'duplicate');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['services'][] = ['id' => 'SVC-CMS', 'name' => 'CMS setup', 'description' => 'A small content site.', 'unit' => 'site', 'unitPriceInr' => 90000, 'effortDays' => 5, 'riskMultiplier' => 1.0];
    $raw['enhancements'][0]['options'][] = ['id' => 'ER-KYC-WEB', 'name' => 'KYC landing page', 'description' => 'A landing page on the KYC app.', 'targetServiceId' => 'SVC-CMS', 'billOfMaterials' => [['serviceId' => 'SVC-CMS', 'qty' => 1], ['serviceId' => 'SVC-REL', 'qty' => 1]]];
    $raw['enhancements'][] = ['id' => 'APP-LATER', 'name' => 'Reserved application', 'description' => 'A group that can gain options later.', 'options' => []];
    $idx = catalogue_index($raw);
    ok(isset($idx['byId']['SVC-CMS']) && isset($idx['optionById']['ER-KYC-WEB']) && $idx['enhancements'][count($idx['enhancements']) - 1]['options'] === [], 'append');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['enhancements'][0]['options'][0]['showcase45'] = 'yes';
    $badFlag = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $badFlag = $e->getMessage() === 'catalogue_bad_showcase45'; }
    ok($badFlag, 'showcase flag');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['newApplications'][0]['grokApi'] = ['ok', 1];
    $badApi = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $badApi = $e->getMessage() === 'catalogue_bad_grokApi'; }
    ok($badApi, 'grokApi');
    $raw = json_decode((string)file_get_contents($cfg['CATALOGUE_FILE']), true);
    $raw['newApplications'][0]['demoScript'] = "two\nlines";
    $badScript = false;
    try { catalogue_index($raw); } catch (RuntimeException $e) { $badScript = $e->getMessage() === 'catalogue_bad_demoScript'; }
    ok($badScript, 'demoScript');
});
t('catalogue: showcase options price from their bill of materials', function () use ($cfg) {
    $expect = [
        'SX-HELPDESK-BOT' => ['PID-ER', 1286850, ['grok-4.7 chat with guidelines and safety_identifier']],
        'SX-LIVE-REVIEW' => ['PID-ER', 385000, ['grok-4.7 with web_search, code_execution and structured outputs']],
        'SX-LANDING-PAGE' => ['PID-NC', 836000, ['grok-4.7 structured output for HTML', 'optional grok-imagine-image-2.0 for a hero image']],
    ];
    foreach ($expect as $id => [$pid, $total, $api]) {
        $opt = catalogue_require_option($cfg, $id);
        ok($opt['pid'] === $pid && $opt['showcase45'] === true && $opt['grokApi'] === $api && is_string($opt['demoScript']) && !str_contains($opt['demoScript'], "\n"), $id);
        $est = finance_price_option($cfg, $id, [], $pid, 'standard');
        ok($est['totalInr'] === $total && $est['urgency'] === 'standard', $id . ' ' . $est['totalInr']);
    }
});
t('catalogue: BOM pricing, unknown option, pid mismatch', function () use ($cfg) {
    $est = finance_price_option($cfg, 'ER-KYC-LABELS', [], 'PID-ER', 'standard');
    ok($est['totalInr'] === 187000 && $est['subtotalInr'] === 170000 && abs($est['effortDays'] - 7.0) < 0.01, json_encode($est));
    ok($est['artifactRefs'] === ['catalogue:ER-KYC-LABELS@example-2026-11'], json_encode($est['artifactRefs']));
    $withAdd = finance_price_option($cfg, 'NC-KYC', ['ADD-NC-KYC-API'], 'PID-NC', 'standard');
    ok($withAdd['totalInr'] === 1907850, 'addon ' . $withAdd['totalInr']);
    $unknown = false;
    try { finance_price_option($cfg, 'NO-SUCH', [], 'PID-ER'); } catch (RuntimeException $e) { $unknown = str_starts_with($e->getMessage(), 'Unknown catalogue option'); }
    ok($unknown, 'unknown option');
    $mismatch = false;
    try { finance_price_option($cfg, 'NC-KYC', [], 'PID-ER'); } catch (RuntimeException $e) { $mismatch = str_contains($e->getMessage(), 'not PID-ER'); }
    ok($mismatch, 'pid mismatch');
});
t('math: 2x UI-S + 1x REL, standard, high conf = 187,000', function () use ($cfg) {
    $e = finance_estimate($cfg, [['serviceId' => 'SVC-UI-S', 'qty' => 2], ['serviceId' => 'SVC-REL', 'qty' => 1]]);
    // subtotal 2*45000*1.0 + 80000*1.0 = 170000; contingency 10% = 17000; total 187000
    ok($e['subtotalInr'] === 170000, 'subtotal ' . $e['subtotalInr']); ok($e['contingencyPct'] === 10, 'pct'); ok($e['totalInr'] === 187000, 'total ' . $e['totalInr']);
    ok($e['budgetBandsInr'] === ['low' => 159000, 'expected' => 187000, 'high' => 234000], json_encode($e['budgetBandsInr']));
    ok(abs($e['effortDays'] - 7.0) < 0.01, 'effort');
});
t('math: KYC (risk 1.3) critical -> risk + urgency + contingency 20%', function () use ($cfg) {
    $e = finance_estimate($cfg, [['serviceId' => 'SVC-KYC', 'qty' => 1]], 'critical');
    // 650000*1.3 = 845000; *1.30 = 1098500; +20% = 1318200
    ok($e['subtotalInr'] === 845000 && $e['contingencyPct'] === 20 && $e['totalInr'] === 1318200, json_encode([$e['subtotalInr'], $e['contingencyPct'], $e['totalInr']]));
});
t('math: unknown ids dropped, qty clamped 1..24, low confidence +5%', function () use ($cfg) {
    $e = finance_estimate($cfg, [['serviceId' => 'NOPE', 'qty' => 3], ['serviceId' => 'SVC-UI-S', 'qty' => 99]], 'standard', 'low');
    ok(count($e['lines']) === 1 && $e['lines'][0]['qty'] === 24 && $e['contingencyPct'] === 15, json_encode($e['lines']));
});
t('policy: small ER -> approve-recommended', function () use ($cfg) {
    [$r] = finance_policy('PID-ER', finance_estimate($cfg, [['serviceId' => 'SVC-UI-S', 'qty' => 1]]), 'high', null); ok($r === 'approve-recommended', $r);
});
t('policy: NC always >= review; high risk -> review; over ceiling -> reject; tiny budget -> reject; no lines -> reject', function () use ($cfg) {
    ok(finance_policy('PID-NC', finance_estimate($cfg, [['serviceId' => 'SVC-UI-S', 'qty' => 1]]), 'high', null)[0] === 'review', 'nc');
    ok(finance_policy('PID-ER', finance_estimate($cfg, [['serviceId' => 'SVC-REG', 'qty' => 1]]), 'high', null)[0] === 'review', 'risk');
    ok(finance_policy('PID-ER', finance_estimate($cfg, [['serviceId' => 'SVC-KYC', 'qty' => 10]]), 'high', null)[0] === 'reject-suggested', 'ceiling');
    ok(finance_policy('PID-ER', finance_estimate($cfg, [['serviceId' => 'SVC-UI-M', 'qty' => 1]]), 'high', 10000)[0] === 'reject-suggested', 'budget');
    ok(finance_policy('PID-ER', finance_estimate($cfg, []), 'high', null)[0] === 'reject-suggested', 'empty');
});
t('assess: missing GROK_API_KEY throws and does not invent a recommendation', function () use ($cfg) {
    $threw = false;
    try {
        finance_assess(['GROK_API_KEY' => ''] + $cfg, ['pid' => 'PID-NC', 'text' => 'new KYC onboarding', 'urgency' => 'standard']);
    } catch (RuntimeException $e) {
        $threw = str_contains($e->getMessage(), 'GROK_API_KEY is not set');
    }
    ok($threw, 'expected a clear configuration error');
});
t('assess: explicit lines from Lead bypass Grok', function () use ($cfg) {
    $a = finance_assess($cfg, ['pid' => 'PID-ER', 'text' => '', 'lines' => [['serviceId' => 'SVC-SEC', 'qty' => 1]]]);
    ok($a['source'] === 'explicit-lines' && $a['estimate']['totalInr'] === 220000, json_encode([$a['source'], $a['estimate']['totalInr']]));
});
$base = ['route' => 'er', 'pid' => 'PID-ER', 'catalogueOptionId' => 'ER-KYC-LABELS', 'addOns' => [],
    'contactName' => 'Jane Doe', 'email' => 'jane@example.com', 'company' => 'Acme', 'customerId' => 'CUST-1042', 'projectRef' => 'PRJ-ONB-7',
    'changeType' => 'enhancement', 'title' => 'Rename two labels', 'description' => 'Rename two labels on the onboarding screen for clarity.', 'urgency' => 'standard', 'consent' => true];
t('validation: valid ER passes; bad ids/date/budget/route caught', function () use ($cfg, $base) {
    ok(intake_validate($base, $cfg)[0] === [], json_encode(intake_validate($base, $cfg)[0]));
    $e = intake_validate(['customerId' => 'bad id with spaces', 'projectRef' => '', 'desiredBy' => '2026-02-30', 'customerBudgetInr' => 'lots', 'urgency' => 'asap'] + $base, $cfg)[0];
    sort($e); ok($e === ['customerBudgetInr', 'customerId', 'desiredBy', 'projectRef', 'urgency'], json_encode($e));
    ok(in_array('route', intake_validate(['route' => 'x'] + $base, $cfg)[0], true), 'route');
    ok(in_array('catalogueOptionId', intake_validate(['catalogueOptionId' => 'NO-SUCH'] + $base, $cfg)[0], true), 'unknown option');
    ok(in_array('pid', intake_validate(['catalogueOptionId' => 'NC-KYC'] + $base, $cfg)[0], true), 'pid mismatch');
});
t('validation: NC requires legalName/jurisdiction/intendedProduct/sponsor', function () use ($cfg, $base) {
    $e = intake_validate(['route' => 'new_customer', 'pid' => 'PID-NC', 'catalogueOptionId' => 'NC-KYC'] + $base, $cfg)[0];
    sort($e); ok($e === ['intendedProduct', 'jurisdiction', 'legalName', 'sponsor'], json_encode($e));
});
t('handoff: proposed handoff passes validate-handoff (ER -> estimation, NC -> discovery)', function () use ($cfg, $base) {
    foreach (['er' => ['PID-ER', 'estimation', 'ER-KYC-LABELS'], 'new_customer' => ['PID-NC', 'discovery', 'NC-KYC']] as $route => [$pid, $stage, $opt]) {
        $d = intake_validate(['route' => $route, 'pid' => $pid, 'catalogueOptionId' => $opt, 'legalName' => 'Acme Pvt Ltd', 'jurisdiction' => 'India', 'intendedProduct' => 'Lending', 'sponsor' => 'R. Rao, CFO'] + $base, $cfg)[1];
        $rid = 'REQ-20261122-000123';
        $fin = finance_assess(['GROK_API_KEY' => ''] + $cfg, ['pid' => $pid, 'text' => $d['description'], 'urgency' => 'standard', 'lines' => [['serviceId' => 'SVC-UI-S', 'qty' => 1]]]);
        $card = intake_build_card($cfg, $rid, $d, $fin, '2026-11-22T12:00:00Z');
        $h = $card['proposedHandoff'];
        ok(handoff_v1_validate($h, 'lead') === [], json_encode(handoff_v1_validate($h, 'lead')));
        ok($h['pid'] === $pid && $h['stage'] === $stage && $h['to'] === 'change-analyst' && $h['thread']['threadId'] === 'thr_20261122000123', 'shape');
        ok($card['to'] === 'lead' && $card['leadBotId'] === '46e50097-0409-4972-9be0-6ade37563135' && $card['kind'] === 'intake-card' && !isset($card['pidState']), 'card');
        ok(in_array("finance:$rid@preliminary", $h['artifactRefs'], true) && str_contains($h['summary'], 'INR'), 'finance in handoff');
    }
});
t('handoff validator: rejects bot approval, non-lead stage-handoff, extra fields, wrong thread', function () {
    $h = ['v' => 1, 'kind' => 'stage-return', 'pid' => 'PID-ER', 'pidVersion' => '1.1.0', 'requestId' => 'REQ-20261122-000123', 'thread' => ['channel' => 'lead-chat', 'threadId' => 'thr_20261122000123'],
        'from' => 'change-analyst', 'to' => 'lead', 'stage' => 'finance-approval', 'action' => 'return', 'summary' => 's', 'artifactRefs' => [], 'memoryKey' => 'pid.state.REQ-20261122-000123',
        'humanGate' => ['gate' => 'finance-approval', 'status' => 'approved', 'decidedBy' => 'change-analyst', 'note' => 'ok']];
    ok(in_array('bot_cannot_approve', handoff_v1_validate($h, 'change-analyst'), true), 'bot approval');
    $h['humanGate'] = ['gate' => 'finance-approval', 'status' => 'approved', 'decidedBy' => 'Vishal Mathur', 'note' => '2026-11-22T18:00:00+05:30 verbatim: "approve"'];
    ok(handoff_v1_validate($h, 'change-analyst') === [], json_encode(handoff_v1_validate($h, 'change-analyst')));
    ok(handoff_v1_validate(['kind' => 'stage-handoff', 'from' => 'security'] + $h, 'security') !== [], 'non-lead handoff');
    ok(handoff_v1_validate(['extra' => 1] + $h, 'change-analyst') !== [], 'extra');
    ok(handoff_v1_validate(['thread' => ['channel' => '#er-intake', 'threadId' => 'x']] + $h, 'change-analyst') !== [], 'thread');
    ok(handoff_v1_validate(['pidState' => []] + $h, 'change-analyst') === ['only_lead_writes_pid_state'], 'pidState');
});
t('status: lifecycle transitions', function () {
    ok(status_allowed_transition('received', 'estimating') && status_allowed_transition('estimating', 'finance-approval') && status_allowed_transition('build', 'security'), 'forward/remediate');
    ok(!status_allowed_transition('finance-approval', 'received') && !status_allowed_transition('done', 'build') && !status_allowed_transition('rejected', 'received'), 'back/terminal');
    ok(status_allowed_transition('security', 'rejected'), 'reject any time');
    ok(STATUS_FROM_STAGE['test-gate'] === 'build' && STATUS_FROM_STAGE['proposal'] === 'estimating' && STATUS_FROM_STAGE['release-gate'] === 'release', 'stage map');
});
t('status: Lead update validation (gate owner, approval wording, quote)', function () {
    $u = ['requestId' => 'REQ-20261122-000123', 'updateId' => 'u-0001', 'from' => 'lead', 'stage' => 'finance-approval', 'message' => 'Estimate ready; finance review next.',
        'nextGate' => ['gate' => 'finance-approval', 'owner' => 'change-analyst'], 'quote' => ['totalInr' => 187000, 'budgetBandsInr' => ['low' => 159000, 'expected' => 187000, 'high' => 234000], 'lines' => [['serviceId' => 'SVC-UI-S', 'qty' => 2, 'lineTotalInr' => 90000]]]];
    [$e, $c] = status_validate_update($u); ok($e === [] && $c['status'] === 'finance-approval', json_encode($e));
    ok(status_validate_update(['nextGate' => ['gate' => 'finance-approval', 'owner' => 'lead']] + $u)[0] === ['nextGate'], 'gate owner');
    ok(status_validate_update(['message' => 'Your request is approved.'] + $u)[0] !== [], 'unnamed approval');
    ok(status_validate_update(['message' => 'Finance approved by Vishal on 22 Nov.'] + $u)[0] === [], 'named approval');
    ok(status_validate_update(['from' => 'change-analyst'] + $u)[0] === ['from'], 'from');
});
foreach ($R as $r) echo $r, "\n";
$f = count(array_filter($R, fn($r) => str_starts_with($r, 'FAIL')));
echo '[unit] ', count($R) - $f, '/', count($R), " passed\n";
exit($f ? 1 : 0);
