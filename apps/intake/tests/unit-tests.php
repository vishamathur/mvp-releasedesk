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
    'contactName' => 'Jane Doe', 'email' => 'jane@example.com', 'company' => 'Acme', 'customerId' => 'cust_1042', 'projectRef' => 'PRJ-ONB-7',
    'changeType' => 'enhancement', 'title' => 'Rename two labels', 'description' => 'Rename two labels on the onboarding screen for clarity.', 'urgency' => 'standard', 'consent' => true];
t('validation: valid ER passes; bad ids/date/budget/route caught', function () use ($cfg, $base) {
    ok(intake_validate($base, $cfg)[0] === [], json_encode(intake_validate($base, $cfg)[0]));
    ok(in_array('customerId', intake_validate(['customerId' => 'CUST-1042'] + $base, $cfg)[0], true), 'hyphenated customer id');
    ok(intake_validate(['customerId' => 'cust_northwind'] + $base, $cfg)[0] === [], 'portfolio customer id');
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
        ok($card['to'] === 'lead' && !isset($card['leadBotId']) && $card['kind'] === 'intake-card' && !isset($card['pidState']), 'card');
        ok(in_array("finance:$rid@preliminary", $h['artifactRefs'], true) && str_contains($h['summary'], 'INR'), 'finance in handoff');
    }
});
$web = ['route' => 'website', 'pid' => 'PID-NC', 'catalogueOptionId' => 'NC-WEBSITE', 'addOns' => [],
    'contactName' => 'Jane Doe', 'email' => 'jane@example.com', 'company' => 'Acme', 'legalName' => 'Acme Pvt Ltd', 'jurisdiction' => 'India', 'sponsor' => 'R. Rao, CFO',
    'siteName' => 'Acme Lending', 'purpose' => 'Explain our lending products and collect enquiries.', 'audience' => 'Small business owners in India',
    'pages' => 'Home, Products, About, Contact', 'mustHaveFeatures' => 'Contact form', 'brandAssets' => 'Logo and colours exist, copy is missing',
    'domainHosting' => 'We own acmelending.example', 'budgetBand' => '150k_300k', 'desiredBy' => '2027-01-31', 'urgency' => 'standard', 'consent' => true];
t('website: valid request passes with no title or description; types are derived', function () use ($cfg, $web) {
    [$e, $d] = intake_validate($web, $cfg);
    ok($e === [], json_encode($e));
    ok($d['requestType'] === 'website-creation' && $d['pid'] === 'PID-NC', 'type');
    ok($d['title'] === 'Website: Acme Lending' && $d['intendedProduct'] === 'Website: Acme Lending', 'defaults');
    ok(str_contains($d['description'], 'Pages needed: Home, Products, About, Contact') && str_contains($d['description'], 'Needed by: 2027-01-31'), 'brief');
    ok($d['customerBudgetInr'] === 300000, 'band ceiling becomes the stated budget');
    [, $d2] = intake_validate(['budgetBand' => 'not_sure', 'description' => 'Please call before building.'] + $web, $cfg);
    ok($d2['customerBudgetInr'] === null && str_contains($d2['description'], 'Notes: Please call before building.'), 'no ceiling, notes kept');
    foreach (['SX-LANDING-PAGE'] as $opt) ok(intake_validate(['catalogueOptionId' => $opt] + $web, $cfg)[0] === [], $opt);
});
t('website: missing brief, bad band, bad date, wrong template and wrong pid are rejected', function () use ($cfg, $web) {
    $e = intake_validate(['legalName' => '', 'jurisdiction' => '', 'sponsor' => '', 'siteName' => '', 'purpose' => '', 'audience' => '', 'pages' => ''] + $web, $cfg)[0];
    sort($e); ok($e === ['audience', 'jurisdiction', 'legalName', 'pages', 'purpose', 'siteName', 'sponsor'], json_encode($e));
    ok(in_array('budgetBand', intake_validate(['budgetBand' => 'free'] + $web, $cfg)[0], true), 'band');
    ok(in_array('desiredBy', intake_validate(['desiredBy' => '2027-02-30'] + $web, $cfg)[0], true), 'date');
    ok(in_array('catalogueOptionId', intake_validate(['catalogueOptionId' => 'NC-KYC'] + $web, $cfg)[0], true), 'non-website template');
    ok(in_array('pid', intake_validate(['pid' => 'PID-ER'] + $web, $cfg)[0], true), 'pid must be PID-NC');
    ok(in_array('addOns', intake_validate(['addOns' => ['ADD-NC-KYC-API']] + $web, $cfg)[0], true), 'add-on of another template');
    ok(intake_validate(['addOns' => ['ADD-NC-WEB-FORMS', 'ADD-NC-WEB-AI']] + $web, $cfg)[0] === [], 'website add-ons');
});
t('website: card carries type and brief; handoff goes to change-analyst at discovery and validates', function () use ($cfg, $web) {
    [$e, $d] = intake_validate($web, $cfg);
    $rid = 'REQ-20261127-000321';
    $fin = finance_assess($cfg, ['pid' => 'PID-NC', 'text' => $d['description'], 'urgency' => 'standard', 'customerBudgetInr' => $d['customerBudgetInr'], 'requestId' => $rid, 'catalogueOptionId' => 'NC-WEBSITE', 'addOns' => []]);
    ok($fin['source'] === 'catalogue-option', json_encode($fin['source']));
    $card = intake_build_card($cfg, $rid, $d, $fin, '2026-11-27T12:00:00Z');
    ok($card['pid'] === 'PID-NC' && $card['requestType'] === 'website-creation' && $card['channel'] === '#new-customer', 'card type');
    $w = $card['requestDetails']['website'] ?? [];
    ok($w['siteName'] === 'Acme Lending' && $w['pages'] === 'Home, Products, About, Contact' && $w['budgetBand'] === '150k_300k' && $w['deadline'] === '2027-01-31'
        && $w['purpose'] !== '' && $w['audience'] !== '' && $w['brandAssets'] !== '' && $w['domainHosting'] !== '' && $w['mustHaveFeatures'] !== '', json_encode($w));
    ok($card['customer']['legalName'] === 'Acme Pvt Ltd' && $card['customer']['intendedProduct'] === 'Website: Acme Lending' && $card['customer']['sponsor'] === 'R. Rao, CFO', 'NC entry facts');
    ok($card['catalogueOptionId'] === 'NC-WEBSITE' && $card['to'] === 'lead' && !isset($card['pidState']), 'card');
    $h = $card['proposedHandoff'];
    ok(handoff_v1_validate($h, 'lead') === [], json_encode(handoff_v1_validate($h, 'lead')));
    ok($h['pid'] === 'PID-NC' && $h['stage'] === 'discovery' && $h['to'] === 'change-analyst' && str_contains($h['summary'], 'website-creation') && str_contains($h['summary'], "intake:$rid"), 'handoff');
    ok(in_array("intake:$rid", $h['artifactRefs'], true), 'artifact ref');
});
t('request types: ER defect/regulatory/enhancement and NC carry requestType; non-website cards have no website details', function () use ($cfg, $base) {
    foreach (['enhancement', 'defect', 'regulatory'] as $ct) {
        [$e, $d] = intake_validate(['changeType' => $ct] + $base, $cfg);
        ok($e === [] && $d['requestType'] === $ct, "$ct " . json_encode($e));
    }
    $fin = finance_assess($cfg, ['pid' => 'PID-ER', 'text' => '', 'lines' => [['serviceId' => 'SVC-UI-S', 'qty' => 1]]]);
    $card = intake_build_card($cfg, 'REQ-20261127-000322', intake_validate(['changeType' => 'defect'] + $base, $cfg)[1], $fin, '2026-11-27T12:00:00Z');
    ok($card['requestType'] === 'defect' && $card['requestDetails'] === null && $card['pid'] === 'PID-ER', 'er card');
    [$e, $d] = intake_validate(['route' => 'new_customer', 'pid' => 'PID-NC', 'catalogueOptionId' => 'NC-KYC', 'legalName' => 'Acme Pvt Ltd', 'jurisdiction' => 'India', 'intendedProduct' => 'Lending', 'sponsor' => 'R. Rao, CFO'] + $base, $cfg);
    ok($e === [] && $d['requestType'] === 'new-application', json_encode($e));
});
t('chat: schema offers the website route, every draft field is required, budget band is enumerated', function () use ($cfg) {
    $cat = catalogue_load($cfg);
    $sch = chat_schema(array_keys($cat['byId']));
    ok(in_array('website', $sch['properties']['route']['enum'], true), 'route');
    foreach (['siteName', 'purpose', 'audience', 'pages', 'mustHaveFeatures', 'brandAssets', 'domainHosting', 'budgetBand', 'desiredBy'] as $f) ok(isset($sch['properties']['draft']['properties'][$f]) && in_array($f, $sch['properties']['draft']['required'], true), $f);
    ok($sch['properties']['draft']['properties']['description']['maxLength'] === 2000 && $sch['properties']['draft']['properties']['purpose']['maxLength'] === 600, 'lengths');
    ok(count(CHAT_DRAFT_FIELDS) <= $sch['properties']['missingFields']['maxItems'], 'missingFields can list every draft field');
    ok(str_contains(chat_system_prompt($cat), 'website: Website creation'), 'prompt');
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
t('cleanup keeps the daily chat limiter for 24 h and drops other buckets after 2 h', function () use ($cfg) {
    $dir = $cfg['DATA_DIR'] . '/ratelimit';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $daily = $dir . '/' . hash('sha256', 'chat-global-day:all') . '.json';
    $other = $dir . '/' . hash('sha256', 'chat:198.51.100.10') . '.json';
    file_put_contents($daily, '[]');
    file_put_contents($other, '[]');
    touch($daily, time() - 3 * 3600);
    touch($other, time() - 3 * 3600);
    $marker = $cfg['DATA_DIR'] . '/.last-cleanup';
    if (is_file($marker)) unlink($marker);
    intake_cleanup($cfg);
    ok(is_file($daily), 'daily kept');
    ok(!is_file($other), 'other dropped');
    touch($daily, time() - 25 * 3600);
    if (is_file($marker)) unlink($marker);
    intake_cleanup($cfg);
    ok(!is_file($daily), 'daily dropped after 24 h');
});
t('N17: a visitor message with a missing or short salt is a fixed 503 and writes no outbox', function () use ($cfg) {
    $priv = getenv('PRIVATE_DIR');
    $pub = dirname(__DIR__) . '/public';
    $port = 9925;
    foreach (['', str_repeat('b', 31)] as $salt) {
        $dir = sys_get_temp_dir() . '/intake-n17-' . bin2hex(random_bytes(4));
        foreach (['/submissions', '/status', '/outbox', '/ratelimit', '/sent'] as $d) mkdir($dir . $d, 0700, true);
        $bare = $cfg;
        $bare['CONTACT_REF_SALT'] = $salt;
        $bare['DATA_DIR'] = $dir;
        $bare['LEAD_DELIVERY'] = 'queue';
        $rid = 'REQ-20261128-000111';
        $token = status_create($bare, $rid, 'PID-ER');
        $conf = $dir . '/intake-config.php';
        file_put_contents($conf, '<?php return ' . var_export($bare, true) . ';');
        $log = $dir . '/php-server.log';
        $proc = proc_open(
            ['php', '-S', '127.0.0.1:' . $port, '-t', $pub],
            [1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']],
            $pipes,
            null,
            ['INTAKE_PRIVATE_DIR' => $priv, 'INTAKE_CONFIG' => $conf, 'PATH' => getenv('PATH') ?: '/usr/bin']
        );
        ok(is_resource($proc), 'server');
        usleep(300000);
        $ch = curl_init("http://127.0.0.1:$port/api/status.php");
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Origin: https://intake.vishalmathur.org'], CURLOPT_POSTFIELDS => json_encode(['ref' => $rid, 'token' => $token, 'message' => 'Any update?'])]);
        $raw = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        proc_terminate($proc);
        proc_close($proc);
        $j = json_decode((string)$raw, true);
        ok($code === 503 && ($j['error'] ?? '') === 'not_configured', json_encode($j) . " code=$code");
        ok(($j['message'] ?? '') === 'This service is temporarily unavailable. Please try again later.', 'fixed message');
        ok(!str_contains((string)$raw, 'CONTACT_REF_SALT'), 'no salt name');
        ok(count(glob("$dir/outbox/*") ?: []) === 0, 'outbox=0');
        ok(count(glob("$dir/submissions/*") ?: []) === 0, 'submissions=0');
        $port++;
    }
});
t('N15: chat markup drops shorteners and lowercase TLDs, and ignores mixed-case typos and text past 10k', function () {
    foreach (['see bit.ly/x', 'chat at t.me/x', 'read docs.dev/guide', 'hxxp://evil.example/a', 'hxxps://evil.example/a', 'notes //evil.example/a', 'ftp://files.example/a', 'tinyurl.com/z', 'goo.gl/z', 'evil.com is great', 'go to evil.com now', 'BIT.LY/x'] as $sample) {
        ok(chat_has_markup($sample), $sample);
        $stripped = chat_strip_markup($sample);
        ok(!str_contains((string)$stripped, $sample), $sample);
    }
    ok(!chat_has_markup('Jane Doe at Acme'), 'plain text');
    ok(!chat_has_markup('Done.Me'), 'Done.Me');
    ok(!chat_has_markup('label.In'), 'label.In');
    ok(chat_strip_markup('Done.Me and label.In') === 'Done.Me and label.In', 'typos stay');
    $pad = str_repeat('a', 10000);
    ok(!chat_has_markup($pad . ' evil.com'), 'domain past 10k');
    ok(chat_has_markup('evil.com ' . $pad), 'domain inside 10k');
});
t('missing or short CONTACT_REF_SALT stores no submission and no outbox', function () use ($cfg) {
    $dir = sys_get_temp_dir() . '/intake-nosalt-' . bin2hex(random_bytes(4));
    foreach (['/submissions', '/status', '/outbox', '/ratelimit', '/sent'] as $d) mkdir($dir . $d, 0700, true);
    foreach (['', str_repeat('a', 21), str_repeat('a', 31)] as $salt) {
        $bare = $cfg;
        $bare['CONTACT_REF_SALT'] = $salt;
        $bare['DATA_DIR'] = $dir;
        $bare['LEAD_DELIVERY'] = 'queue';
        ob_start();
        api_intake($bare);
        $body = ob_get_clean();
        $j = json_decode($body, true);
        ok(http_response_code() === 503 && ($j['error'] ?? '') === 'not_configured', json_encode($j));
        ok(($j['message'] ?? '') === 'This service is temporarily unavailable. Please try again later.', 'fixed message');
        ok(!str_contains((string)($j['message'] ?? ''), 'CONTACT_REF_SALT'), 'no salt name');
        ok(count(glob("$dir/submissions/*") ?: []) === 0, 'submissions=0');
        ok(count(glob("$dir/outbox/*") ?: []) === 0, 'outbox=0');
        $threw = false;
        try { delivery_send($bare, 'intake-card', 'REQ-20261128-000001', ['contact' => ['email' => 'jane@example.com', 'name' => 'Jane']]); }
        catch (RuntimeException $e) { $threw = str_contains($e->getMessage(), 'CONTACT_REF_SALT'); }
        ok($threw && count(glob("$dir/outbox/*") ?: []) === 0, 'delivery writes no outbox');
    }
});
t('shared signing vector matches PHP purpose keys and the salted contact ref', function () {
    $vector = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/intake-cloudflare/test/fixtures/signing-vector.json'), true);
    foreach ($vector['signatures'] as $row) {
        ok(intake_sign($vector['master'], $row['purpose'], $row['message']) === $row['hex'], $row['purpose']);
    }
    ok(contact_ref($vector['contactSalt'], $vector['email']) === $vector['contactRef'], 'contact ref');
});
foreach ($R as $r) echo $r, "\n";
$f = count(array_filter($R, fn($r) => str_starts_with($r, 'FAIL')));
echo '[unit] ', count($R) - $f, '/', count($R), " passed\n";
exit($f ? 1 : 0);
