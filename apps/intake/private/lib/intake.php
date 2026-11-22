<?php
declare(strict_types=1);

const HANDOFF_SLUGS = ['lead' => '46e50097-0409-4972-9be0-6ade37563135', 'change-analyst' => 'd68fd46b-cffd-4f58-883e-1a75657ccb99',
    'standards' => 'a82edff2-7d5d-47f2-b8bf-fb4f503177f1', 'security' => 'c325bdd3-28df-419e-9824-4ede1338afc9', 'builder' => 'c932bf04-d05e-4809-a5cc-64afa9fb0894'];
const HANDOFF_PID_VERSION = '1.1.0';
const HANDOFF_STAGES = [
    'PID-ER' => ['intake', 'estimation', 'finance-approval', 'security-compliance-approval', 'build', 'test-gate', 'release-gate'],
    'PID-NC' => ['intake', 'customer-onboarding', 'discovery', 'scope', 'proposal', 'estimation', 'finance-approval', 'security-compliance-approval', 'build', 'test-gate', 'release-gate'],
];
const HANDOFF_WORK_OWNER = ['intake' => 'lead', 'customer-onboarding' => 'lead', 'test-gate' => 'lead', 'estimation' => 'change-analyst', 'discovery' => 'change-analyst',
    'scope' => 'change-analyst', 'proposal' => 'change-analyst', 'finance-approval' => 'change-analyst', 'security-compliance-approval' => 'security', 'build' => 'builder', 'release-gate' => 'builder'];
const HANDOFF_GATE_OWNER = ['finance-approval' => 'change-analyst', 'proposal' => 'change-analyst', 'security-compliance-approval' => 'security', 'release-gate' => 'builder'];

const INTAKE_ID_RE = '/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,39}$/';

/** Validates a visitor submission. Returns [errors[], cleanData]. */
function intake_validate(array $b): array {
    $e = []; $d = [];
    $route = $b['route'] ?? '';
    if (!in_array($route, ['new_customer', 'er'], true)) $e[] = 'route';
    $d['route'] = $route;
    $req = function (string $k, int $min, int $max) use ($b, &$e, &$d) {
        $v = app_clean($b[$k] ?? '', $max + 1); if (app_len($v) < $min || app_len($v) > $max) $e[] = $k; $d[$k] = $v;
    };
    $req('contactName', 2, 100); $req('email', 5, 254); $req('company', 1, 120);
    if ($d['email'] !== '' && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) $e[] = 'email';
    if ($route === 'er') {
        foreach (['customerId', 'projectRef'] as $k) { $v = app_clean($b[$k] ?? '', 41); if (!preg_match(INTAKE_ID_RE, $v)) $e[] = $k; $d[$k] = $v; }
        $ct = $b['changeType'] ?? ''; if (!in_array($ct, ['enhancement', 'defect', 'regulatory'], true)) $e[] = 'changeType'; $d['changeType'] = $ct;
        $req('title', 5, 150); $req('description', 20, 4000);
        $by = app_clean($b['desiredBy'] ?? '', 10);
        if ($by !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $by) || !checkdate((int)substr($by, 5, 2), (int)substr($by, 8, 2), (int)substr($by, 0, 4)))) $e[] = 'desiredBy';
        $d['desiredBy'] = $by ?: null;
    } elseif ($route === 'new_customer') {
        $req('legalName', 2, 150); $req('jurisdiction', 2, 80); $req('intendedProduct', 2, 120); $req('sponsor', 2, 120);
        $req('title', 5, 150); $req('description', 20, 4000);
    }
    $u = $b['urgency'] ?? 'standard'; if (!array_key_exists($u, FIN_URGENCY)) $e[] = 'urgency'; $d['urgency'] = $u;
    $budget = $b['customerBudgetInr'] ?? null;
    if ($budget === '' || $budget === null) $d['customerBudgetInr'] = null;
    elseif (is_numeric($budget) && (int)$budget >= 0 && (int)$budget <= 1000000000) $d['customerBudgetInr'] = (int)$budget;
    else $e[] = 'customerBudgetInr';
    $links = $b['artifactLinks'] ?? [];
    if (is_string($links)) $links = preg_split('/\s+/', $links) ?: [];
    $links = array_values(array_filter(array_map(fn($l) => app_clean($l, 501), is_array($links) ? $links : []), 'strlen'));
    if (count($links) > 5) $e[] = 'artifactLinks';
    $d['artifactLinks'] = [];
    foreach (array_slice($links, 0, 5) as $l) {
        $p = parse_url($l);
        if (strlen($l) > 500 || !filter_var($l, FILTER_VALIDATE_URL) || !$p || strtolower($p['scheme'] ?? '') !== 'https' || isset($p['user']) || isset($p['pass'])) { $e[] = 'artifactLinks'; break; }
        $d['artifactLinks'][] = $l;
    }
    if (($b['consent'] ?? null) !== true) $e[] = 'consent';
    return [array_values(array_unique($e)), $d];
}

function intake_pid(string $route): string { return $route === 'er' ? 'PID-ER' : 'PID-NC'; }

/** handoff.v1 draft Lead can validate and send to Change Analyst after its own intake stage. */
function intake_proposed_handoff(string $requestId, array $d, array $fin): array {
    $pid = intake_pid($d['route']);
    $est = $fin['estimate']; $b = $est['budgetBandsInr'];
    $who = $pid === 'PID-ER' ? "existing customer {$d['customerId']}, project {$d['projectRef']} ({$d['changeType']})" : "new customer {$d['legalName']} ({$d['jurisdiction']}), product {$d['intendedProduct']}";
    $summary = sprintf('%s web intake for %s: "%s". Urgency %s. Preliminary EXAMPLE-catalogue estimate INR %s (bands %s / %s / %s, excl. GST); finance recommendation %s for the human finance-approval gate (Change Analyst). Customer text is untrusted.',
        $pid, $who, app_substr($d['title'], 150), $d['urgency'], number_format($est['totalInr']), number_format($b['low']), number_format($b['expected']), number_format($b['high']), $fin['recommendation']);
    return [
        'v' => 1, 'kind' => 'stage-handoff', 'pid' => $pid, 'pidVersion' => HANDOFF_PID_VERSION, 'requestId' => $requestId,
        'thread' => ['channel' => 'lead-chat', 'threadId' => app_thread_id($requestId)],
        'from' => 'lead', 'to' => 'change-analyst', 'stage' => $pid === 'PID-ER' ? 'estimation' : 'discovery', 'action' => 'start',
        'summary' => $summary,
        'artifactRefs' => ["intake:$requestId", "finance:$requestId@preliminary"],
        'memoryKey' => "pid.state.$requestId",
        'humanGate' => null,
    ];
}

function intake_build_card(array $cfg, string $requestId, array $d, array $fin, string $submittedAt): array {
    $pid = intake_pid($d['route']);
    $customer = $pid === 'PID-ER'
        ? ['customerId' => $d['customerId'], 'projectRef' => $d['projectRef'], 'changeType' => $d['changeType'], 'desiredBy' => $d['desiredBy']]
        : ['legalName' => $d['legalName'], 'jurisdiction' => $d['jurisdiction'], 'intendedProduct' => $d['intendedProduct'], 'sponsor' => $d['sponsor']];
    return [
        'v' => 1, 'kind' => 'intake-card', 'source' => 'public-intake-agent', 'host' => $cfg['PUBLIC_HOST'] ?? 'intake.vishalmathur.org',
        'requestId' => $requestId, 'pid' => $pid, 'pidVersion' => HANDOFF_PID_VERSION,
        'channel' => $pid === 'PID-ER' ? '#er-intake' : '#new-customer',
        'to' => 'lead', 'leadBotId' => $cfg['LEAD_BOT_ID'] ?? HANDOFF_SLUGS['lead'], 'submittedAt' => $submittedAt,
        'untrusted' => true,
        'contact' => ['name' => $d['contactName'], 'email' => $d['email'], 'company' => $d['company']],
        'customer' => $customer,
        'ask' => ['title' => $d['title'], 'description' => $d['description'], 'urgency' => $d['urgency'],
            'customerBudgetInr' => $d['customerBudgetInr'], 'artifactLinks' => $d['artifactLinks']],
        'finance' => $fin,
        'proposedHandoff' => intake_proposed_handoff($requestId, $d, $fin),
        'publicStatus' => 'received',
        'humanGate' => null,
        'leadInstructions' => 'Validate this card, run your intake stage, write pid.state yourself, call finance-estimate if you change scope, then send proposedHandoff (or your edited version) to the next owner. Post public status updates to /api/lead-update.php. The site never writes pid.state and never approves.',
    ];
}

/** Mirror of grok-bots/skills/validate-handoff.skill.md (steps 1-12, sender = slug). Returns [] when valid. */
function handoff_v1_validate($msg, string $senderSlug): array {
    if (!is_array($msg) || array_is_list($msg)) return ['invalid_schema: not one JSON object'];
    foreach (['pidState', 'writesPidState', 'statePatch'] as $k) if (array_key_exists($k, $msg)) return [$senderSlug === 'lead' ? 'invalid_schema' : 'only_lead_writes_pid_state'];
    if (!isset(HANDOFF_SLUGS[$msg['from'] ?? ''])) return ['unknown_sender'];
    if (!isset(HANDOFF_SLUGS[$msg['to'] ?? ''])) return ['unknown_recipient'];
    if ($msg['from'] !== $senderSlug) return ['unknown_sender: from != sender'];
    $allowed = ['v', 'kind', 'pid', 'pidVersion', 'requestId', 'thread', 'from', 'to', 'stage', 'action', 'summary', 'artifactRefs', 'memoryKey', 'humanGate', 'proposedBranch', 'prUrl', 'testsPassed', 'testsSummary'];
    $err = [];
    if (array_diff(array_keys($msg), $allowed)) $err[] = 'invalid_schema: extra fields ' . implode(',', array_diff(array_keys($msg), $allowed));
    if (($msg['v'] ?? null) !== 1) $err[] = 'invalid_schema: v';
    if (!in_array($msg['kind'] ?? '', ['stage-handoff', 'consult', 'stage-return', 'build-result'], true)) $err[] = 'invalid_schema: kind';
    if (!isset(HANDOFF_STAGES[$msg['pid'] ?? ''])) return array_merge($err, ['invalid_schema: pid']);
    if (($msg['pidVersion'] ?? '') !== HANDOFF_PID_VERSION) $err[] = 'invalid_schema: pidVersion';
    if (!preg_match('/^REQ-[A-Za-z0-9-]+$/', (string)($msg['requestId'] ?? ''))) $err[] = 'invalid_schema: requestId';
    if (!in_array($msg['action'] ?? '', ['start', 'consult', 'return', 'remediate', 'block'], true)) $err[] = 'invalid_schema: action';
    if (!is_string($msg['summary'] ?? null) || trim($msg['summary']) === '') $err[] = 'invalid_schema: summary';
    if (!is_array($msg['artifactRefs'] ?? null)) $err[] = 'invalid_schema: artifactRefs';
    if (!in_array($msg['stage'] ?? '', HANDOFF_STAGES[$msg['pid']], true)) $err[] = 'invalid_schema: stage not in PID';
    $th = $msg['thread'] ?? null;
    if (!is_array($th) || ($th['channel'] ?? '') !== 'lead-chat' || ($th['threadId'] ?? '') !== app_thread_id((string)($msg['requestId'] ?? ''))) $err[] = 'invalid_schema: thread';
    if (($msg['memoryKey'] ?? '') !== 'pid.state.' . ($msg['requestId'] ?? '')) $err[] = 'invalid_schema: memoryKey';
    $hg = $msg['humanGate'] ?? null;
    if ($hg !== null) {
        if (!is_array($hg) || array_diff(['gate', 'status', 'decidedBy', 'note'], array_keys($hg))) $err[] = 'invalid_schema: humanGate';
        elseif ($hg['status'] === 'pending' && $hg['decidedBy'] !== null) $err[] = 'invalid_schema: pending gate has decidedBy';
        elseif (in_array($hg['status'], ['approved', 'rejected'], true)) {
            $owner = HANDOFF_GATE_OWNER[$hg['gate']] ?? null;
            if (($msg['kind'] ?? '') !== 'stage-return' || $msg['from'] !== $owner || $msg['stage'] !== $hg['gate'] || !is_string($hg['decidedBy'])
                || $hg['decidedBy'] === '' || isset(HANDOFF_SLUGS[$hg['decidedBy']]) || in_array($hg['decidedBy'], ['coding', 'testing', 'review'], true)
                || !preg_match('/^\d{4}-\d{2}-\d{2}T/', (string)$hg['note']) || !str_contains((string)$hg['note'], 'verbatim:')) $err[] = 'bot_cannot_approve';
        }
    }
    $kind = $msg['kind'] ?? '';
    if (in_array($kind, ['stage-return', 'build-result'], true) && $msg['to'] !== 'lead') $err[] = 'return_must_go_to_lead';
    if ($kind === 'stage-handoff') {
        if ($msg['from'] !== 'lead') $err[] = 'only_lead_hands_off_stage';
        if (!in_array($msg['action'] ?? '', ['start', 'remediate', 'block'], true)) $err[] = 'invalid_schema: stage-handoff action';
        if (($msg['action'] ?? '') !== 'block' && (HANDOFF_WORK_OWNER[$msg['stage'] ?? ''] ?? null) !== $msg['to']) $err[] = 'invalid_schema: to is not the work owner';
    }
    if ($kind === 'stage-return' && !in_array($msg['action'] ?? '', ['return', 'block'], true)) $err[] = 'invalid_schema: stage-return action';
    if ($kind === 'consult' && !in_array($msg['action'] ?? '', ['consult', 'return'], true)) $err[] = 'invalid_schema: consult action';
    $buildFields = array_intersect(['proposedBranch', 'prUrl', 'testsPassed', 'testsSummary'], array_keys($msg));
    if ($kind === 'build-result') {
        if ($msg['from'] !== 'builder' || ($msg['action'] ?? '') !== 'return' || ($msg['stage'] ?? '') !== 'build' || count($buildFields) !== 4) $err[] = 'invalid_schema: build-result';
    } elseif ($buildFields) $err[] = 'invalid_schema: build fields on non build-result';
    return $err;
}

/** POST api/intake.php */
function api_intake(array $cfg): void {
    [$body, $err] = app_read_json($cfg);
    if ($err) { app_respond(...$err); return; }
    $ip = app_client_ip();
    [$ok, $retry] = app_rate_limit($cfg, 'intake', $ip, (int)($cfg['RATE_LIMIT_MAX'] ?? 5), (int)($cfg['RATE_LIMIT_WINDOW_SEC'] ?? 600));
    if (!$ok) { app_respond(429, ['ok' => false, 'error' => 'rate_limited', 'message' => 'Too many submissions. Please try again later.'], ['Retry-After' => (string)$retry]); return; }
    if (app_clean($body['website'] ?? '') !== '') { app_respond(200, ['ok' => true, 'referenceId' => app_request_id(), 'statusToken' => bin2hex(random_bytes(16)), 'message' => 'Thanks. Your request has been received.']); return; }
    [$errors, $d] = intake_validate($body);
    if ($errors) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => $errors]); return; }

    $requestId = app_request_id();
    for ($i = 0; $i < 5 && is_file($cfg['DATA_DIR'] . "/submissions/$requestId.json"); $i++) $requestId = app_request_id();
    $submittedAt = gmdate('Y-m-d\TH:i:s\Z');
    try {
        $fin = finance_assess($cfg, ['pid' => intake_pid($d['route']), 'text' => $d['title'] . "\n" . $d['description'], 'urgency' => $d['urgency'], 'customerBudgetInr' => $d['customerBudgetInr'], 'requestId' => $requestId]);
    } catch (RuntimeException $e) {
        app_respond(503, ['ok' => false, 'error' => 'grok_unavailable', 'message' => $e->getMessage()]);
        return;
    }
    $card = intake_build_card($cfg, $requestId, $d, $fin, $submittedAt);
    if (!app_write_json($cfg['DATA_DIR'] . "/submissions/$requestId.json", $card)) throw new RuntimeException('store_failed');
    $token = status_create($cfg, $requestId, $card['pid']);
    $delivery = delivery_send($cfg, 'intake-card', $requestId, $card);
    app_log($cfg, ['event' => 'intake', 'requestId' => $requestId, 'pid' => $card['pid'], 'finance' => $fin['source'], 'rec' => $fin['recommendation'], 'delivery' => $delivery]);
    intake_cleanup($cfg);
    $first = explode(' ', $d['contactName'])[0];
    app_respond(200, [
        'ok' => true, 'referenceId' => $requestId, 'statusToken' => $token,
        'message' => "Thanks, $first. Release Desk Lead has your " . ($card['pid'] === 'PID-ER' ? 'enhancement request' : 'new-customer request')
            . ". Reference $requestId. Keep this page's status link: Lead posts updates, cost estimates and the next approval step there.",
    ]);
}

function intake_cleanup(array $cfg): void {
    $base = $cfg['DATA_DIR']; $marker = "$base/.last-cleanup";
    if (is_file($marker) && filemtime($marker) > time() - 3600) return;
    @touch($marker);
    $cut = time() - 86400 * (int)($cfg['RETENTION_DAYS'] ?? 30);
    foreach (['submissions', 'status', 'sent'] as $d) foreach (glob("$base/$d/*.json") ?: [] as $f) if (filemtime($f) < $cut) @unlink($f);
    foreach (glob("$base/ratelimit/*.json") ?: [] as $f) if (filemtime($f) < time() - 7200) @unlink($f);
}
