<?php
declare(strict_types=1);
/*
 * Finance estimation model.
 *  (a) finance_estimate(): deterministic cost from catalogue lines x qty x risk x urgency + contingency.
 *  (b) finance_assess(): Grok maps free text to catalogue lines and writes a recommendation;
 *      the deterministic policy is a floor Grok can only make STRICTER. A missing key or a
 *      failed call throws. There is no stand-in mapping. Output is a RECOMMENDATION for
 *      Change Analyst's finance-approval gate. It never approves anything.
 */

const FIN_URGENCY = ['standard' => 1.00, 'expedited' => 1.15, 'critical' => 1.30];
const FIN_RECS = ['approve-recommended' => 0, 'review' => 1, 'reject-suggested' => 2];
const FIN_POLICY = [
    'contingencyBasePct' => 10, 'contingencyHighRiskPct' => 5, 'contingencyCriticalPct' => 5, 'contingencyLowConfidencePct' => 5,
    'erApproveCeilingInr' => 500000,     // ER at or below this, low risk, high confidence -> approve-recommended
    'hardCeilingInr' => 5000000,         // above this -> reject-suggested (out of envelope for web intake)
    'highRiskThreshold' => 1.3,
    'maxQtyPerLine' => 24,
    'bandLowPct' => 85, 'bandHighPct' => 125,
];

function fin_round_to(float $v, int $step = 1000): int { return (int)(round($v / $step) * $step); }

function fin_is_catalogue_error(Throwable $e): bool {
    $m = $e->getMessage();
    return str_starts_with($m, 'Unknown catalogue option')
        || str_starts_with($m, 'Catalogue option ')
        || str_starts_with($m, 'Unknown add-on')
        || str_starts_with($m, 'Add-on ');
}

/** @param array<int,array{serviceId:string,qty:int}> $lines */
function finance_estimate(array $cfg, array $lines, string $urgency = 'standard', string $confidence = 'high'): array {
    $cat = catalogue_load($cfg)['byId'];
    $urg = FIN_URGENCY[$urgency] ?? FIN_URGENCY['standard'];
    $out = []; $subtotal = 0.0; $effort = 0.0; $maxRisk = 1.0;
    foreach ($lines as $l) {
        $s = $cat[$l['serviceId'] ?? ''] ?? null;
        if (!$s) continue;
        $qty = max(1, min(FIN_POLICY['maxQtyPerLine'], (int)($l['qty'] ?? 1)));
        $lineTotal = $s['unitPriceInr'] * $qty * $s['riskMultiplier'];
        $out[] = ['serviceId' => $s['id'], 'name' => $s['name'], 'unit' => $s['unit'], 'qty' => $qty, 'unitPriceInr' => $s['unitPriceInr'],
            'riskMultiplier' => $s['riskMultiplier'], 'lineTotalInr' => (int)round($lineTotal), 'effortDays' => round($s['effortDays'] * $qty * $s['riskMultiplier'], 1)];
        $subtotal += $lineTotal; $effort += $s['effortDays'] * $qty * $s['riskMultiplier']; $maxRisk = max($maxRisk, $s['riskMultiplier']);
    }
    $pct = FIN_POLICY['contingencyBasePct']
        + ($maxRisk >= FIN_POLICY['highRiskThreshold'] ? FIN_POLICY['contingencyHighRiskPct'] : 0)
        + ($urgency === 'critical' ? FIN_POLICY['contingencyCriticalPct'] : 0)
        + ($confidence === 'low' ? FIN_POLICY['contingencyLowConfidencePct'] : 0);
    $afterUrgency = $subtotal * $urg;
    $contingency = $afterUrgency * $pct / 100;
    $total = (int)round($afterUrgency + $contingency);
    return [
        'currency' => 'INR', 'taxNote' => 'excl. GST', 'catalogueVersion' => catalogue_load($cfg)['version'] ?? '', 'example' => true,
        'lines' => $out,
        'subtotalInr' => (int)round($subtotal),
        'urgency' => array_key_exists($urgency, FIN_URGENCY) ? $urgency : 'standard', 'urgencyMultiplier' => $urg,
        'contingencyPct' => $pct, 'contingencyInr' => (int)round($contingency),
        'totalInr' => $total,
        'effortDays' => round($effort * ($urgency === 'critical' ? 1.0 : 1.0), 1),
        'maxRiskMultiplier' => $maxRisk,
        'budgetBandsInr' => ['low' => fin_round_to($total * FIN_POLICY['bandLowPct'] / 100), 'expected' => fin_round_to($total), 'high' => fin_round_to($total * FIN_POLICY['bandHighPct'] / 100)],
        'artifactRefs' => [],
    ];
}

/**
 * Price a catalogue option from its bill of materials plus selected add-ons.
 * Unknown option or add-on throws. The lines are not guessed from free text.
 */
function finance_price_option(array $cfg, string $optionId, array $addOnIds, string $pid, string $urgency = 'standard'): array {
    $lines = catalogue_option_lines($cfg, $optionId, $addOnIds, $pid);
    $est = finance_estimate($cfg, $lines, $urgency, 'high');
    $version = (string)(catalogue_load($cfg)['version'] ?? '');
    $est['catalogueOptionId'] = $optionId;
    $est['catalogueVersion'] = $version;
    $est['addOns'] = array_values($addOnIds);
    $est['artifactRefs'] = ['catalogue:' . $optionId . '@' . $version];
    return $est;
}

/** Deterministic policy. Returns [recommendation, reasons[]]. */
function finance_policy(string $pid, array $est, string $confidence, ?int $customerBudget): array {
    $reasons = [];
    if (!$est['lines']) return ['reject-suggested', ['No catalogue service matches the request; needs a bespoke proposal.']];
    if ($est['totalInr'] > FIN_POLICY['hardCeilingInr']) return ['reject-suggested', ['Estimate exceeds the web-intake ceiling of INR ' . number_format(FIN_POLICY['hardCeilingInr']) . '.']];
    if ($customerBudget !== null && $customerBudget > 0 && $customerBudget < $est['budgetBandsInr']['low'] * 0.5)
        return ['reject-suggested', ['Stated budget is under half of the low estimate band.']];
    if ($pid === 'PID-NC') $reasons[] = 'New customer: commercial terms need a finance review.';
    if ($pid === 'PID-ER' && $est['totalInr'] > FIN_POLICY['erApproveCeilingInr']) $reasons[] = 'Above the INR ' . number_format(FIN_POLICY['erApproveCeilingInr']) . ' enhancement threshold.';
    if ($est['maxRiskMultiplier'] >= FIN_POLICY['highRiskThreshold']) $reasons[] = 'Includes a high-risk service (risk multiplier >= ' . FIN_POLICY['highRiskThreshold'] . ').';
    if ($est['urgency'] === 'critical') $reasons[] = 'Critical urgency adds cost and delivery risk.';
    if ($confidence !== 'high') $reasons[] = 'Mapping from free text to catalogue is not high-confidence.';
    if ($customerBudget !== null && $customerBudget > 0 && $customerBudget < $est['budgetBandsInr']['expected']) $reasons[] = 'Stated budget is below the expected estimate.';
    return $reasons ? ['review', $reasons] : ['approve-recommended', ['Small, low-risk enhancement within the catalogue and threshold.']];
}

function finance_schema(array $ids): array {
    return [
        'type' => 'object', 'additionalProperties' => false,
        'required' => ['lines', 'mappingConfidence', 'recommendation', 'rationale', 'risks', 'openQuestions', 'suspectedPromptInjection'],
        'properties' => [
            'lines' => ['type' => 'array', 'maxItems' => 8, 'items' => ['type' => 'object', 'additionalProperties' => false,
                'required' => ['serviceId', 'qty', 'reason'],
                'properties' => ['serviceId' => ['type' => 'string', 'enum' => $ids], 'qty' => ['type' => 'integer', 'minimum' => 1, 'maximum' => FIN_POLICY['maxQtyPerLine']], 'reason' => ['type' => 'string', 'maxLength' => 200]]]],
            'mappingConfidence' => ['type' => 'string', 'enum' => ['high', 'medium', 'low']],
            'recommendation' => ['type' => 'string', 'enum' => array_keys(FIN_RECS)],
            'rationale' => ['type' => 'string', 'maxLength' => 600],
            'risks' => ['type' => 'array', 'maxItems' => 6, 'items' => ['type' => 'string', 'maxLength' => 200]],
            'openQuestions' => ['type' => 'array', 'maxItems' => 6, 'items' => ['type' => 'string', 'maxLength' => 200]],
            'suspectedPromptInjection' => ['type' => 'boolean'],
        ],
    ];
}

/**
 * Full assessment. $req: pid, text, urgency, customerBudgetInr (nullable), lines (optional explicit override from Lead).
 */
function finance_assess(array $cfg, array $req): array {
    $pid = $req['pid'] === 'PID-NC' ? 'PID-NC' : 'PID-ER';
    $urgency = array_key_exists($req['urgency'] ?? '', FIN_URGENCY) ? $req['urgency'] : 'standard';
    $budget = isset($req['customerBudgetInr']) && is_numeric($req['customerBudgetInr']) ? (int)$req['customerBudgetInr'] : null;
    $cat = catalogue_load($cfg);
    $source = 'grok'; $grok = null; $error = null;
    $priced = null;

    if (trim((string)($req['catalogueOptionId'] ?? '')) !== '') {
        $addOns = [];
        foreach ((array)($req['addOns'] ?? []) as $id) $addOns[] = (string)$id;
        $priced = finance_price_option($cfg, (string)$req['catalogueOptionId'], $addOns, $pid, $urgency);
        $lines = array_map(fn($l) => ['serviceId' => $l['serviceId'], 'qty' => $l['qty']], $priced['lines']);
        $confidence = 'high';
        $source = 'catalogue-option';
    } elseif (!empty($req['lines']) && is_array($req['lines'])) {
        $lines = $req['lines']; $confidence = 'high'; $source = 'explicit-lines';
    } else {
        try {
            if (trim((string)($cfg['GROK_API_KEY'] ?? '')) === '') {
                throw new RuntimeException('GROK_API_KEY is not set. Refusing to invent a finance recommendation.');
            }
            $menu = array_map(fn($s) => "{$s['id']} | {$s['name']} | per {$s['unit']} | INR {$s['unitPriceInr']} | {$s['description']}", array_values($cat['byId']));
            $system = "You are the finance estimation assistant for Release Desk (software delivery). Map the request to catalogue services and quantities, then give a finance-approval RECOMMENDATION for a human Finance partner. You never approve.\n"
                . "Use only these catalogue ids (EXAMPLE prices, INR, excl. GST):\n" . implode("\n", $menu) . "\n"
                . "Recommendation: approve-recommended only for small, clear, low-risk enhancements; review when scope, risk, cost or customer is uncertain; reject-suggested when out of catalogue scope or clearly unviable.\n"
                . GROK_UNTRUSTED_RULES;
            $user = "<visitor_input>\n" . json_encode(['pid' => $pid, 'urgency' => $urgency, 'statedBudgetInr' => $budget, 'request' => app_substr((string)$req['text'], 4000)], JSON_UNESCAPED_UNICODE) . "\n</visitor_input>";
            $safety = trim((string)($req['requestId'] ?? ''));
            if ($safety === '') throw new RuntimeException('requestId is required for a Grok finance assessment.');
            $grok = grok_json($cfg, $system, $user, 'finance_assessment', finance_schema(array_keys($cat['byId'])), $safety);
            $lines = array_values(array_filter($grok['lines'], fn($l) => isset($cat['byId'][$l['serviceId'] ?? ''])));
            $confidence = $grok['mappingConfidence'];
            if (!$lines) throw new RuntimeException('grok_no_valid_lines');
        } catch (Throwable $e) {
            $why = $e->getMessage();
            if (!str_contains($why, 'Refusing to invent')) {
                $why = 'Grok finance assessment failed (' . $why . '). Refusing to invent a finance recommendation.';
            }
            throw new RuntimeException($why);
        }
    }
    $est = $priced ?? finance_estimate($cfg, $lines, $urgency, $confidence);
    [$policyRec, $reasons] = finance_policy($pid, $est, $confidence, $budget);
    $grokRec = $grok['recommendation'] ?? null;
    $injection = !empty($grok['suspectedPromptInjection']);
    $final = ($grokRec !== null && FIN_RECS[$grokRec] > FIN_RECS[$policyRec]) ? $grokRec : $policyRec; // Grok can only tighten
    if ($injection) { $final = $policyRec; $reasons[] = 'Possible prompt injection in the request text. The recommendation is the policy recommendation only.'; }

    return [
        'model' => 'releasedesk-finance-v1',
        'source' => $source,
        'grokModel' => $source === 'grok' ? ($cfg['GROK_MODEL'] ?? 'grok-4.20-0309-non-reasoning') : null,
        'grokError' => $error,
        'estimate' => $est,
        'mappingConfidence' => $confidence,
        'recommendation' => $final,
        'policyRecommendation' => $policyRec,
        'grokRecommendation' => $grokRec,
        'policyReasons' => $reasons,
        'rationale' => $injection ? implode(' ', $reasons) : ($grok['rationale'] ?? implode(' ', $reasons)),
        'lineReasons' => $grok ? array_map(fn($l) => ['serviceId' => $l['serviceId'], 'reason' => $l['reason']], $grok['lines']) : [],
        'risks' => $grok['risks'] ?? [],
        'openQuestions' => $grok['openQuestions'] ?? [],
        'suspectedPromptInjection' => $injection,
        'gate' => ['gate' => 'finance-approval', 'owner' => 'change-analyst', 'decidedBy' => null, 'status' => 'pending', 'suspectedPromptInjection' => $injection],
        'notice' => 'Recommendation only. The finance-approval decision is made by a human (Vishal / Finance partner) through Change Analyst.',
        'artifactRefs' => $est['artifactRefs'] ?? [],
    ];
}

/** POST api/finance-estimate.php : callable by Release Desk Lead (HMAC-signed). */
function api_finance_estimate(array $cfg): void {
    [$body, $err] = app_read_json($cfg, false);
    if ($err) { app_respond(...$err); return; }
    if ($why = app_verify_lead_signature($cfg, $GLOBALS['APP_RAW_BODY'])) { app_log($cfg, ['event' => 'finance_auth_failed', 'why' => $why]); app_respond(401, ['ok' => false, 'error' => 'unauthorized']); return; }
    $pid = in_array($body['pid'] ?? '', ['PID-ER', 'PID-NC'], true) ? $body['pid'] : null;
    $text = app_clean($body['text'] ?? '', 4000);
    $optionId = app_clean($body['catalogueOptionId'] ?? '', 80);
    if (!$pid || ($text === '' && empty($body['lines']) && $optionId === '')) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => ['pid', 'text']]); return; }
    $lines = [];
    foreach (array_slice((array)($body['lines'] ?? []), 0, 8) as $l) if (is_array($l)) $lines[] = ['serviceId' => app_clean($l['serviceId'] ?? '', 20), 'qty' => (int)($l['qty'] ?? 1)];
    $addOns = [];
    foreach ((array)($body['addOns'] ?? []) as $id) if (is_string($id)) $addOns[] = app_clean($id, 80);
    $rid = app_clean($body['requestId'] ?? '', 40);
    try {
        $res = finance_assess($cfg, ['pid' => $pid, 'text' => $text, 'urgency' => app_clean($body['urgency'] ?? 'standard', 20),
            'customerBudgetInr' => $body['customerBudgetInr'] ?? null, 'lines' => $lines, 'requestId' => $rid,
            'catalogueOptionId' => $optionId, 'addOns' => $addOns]);
    } catch (RuntimeException $e) {
        if (fin_is_catalogue_error($e)) { app_respond(400, ['ok' => false, 'error' => 'catalogue', 'message' => $e->getMessage()]); return; }
        app_respond_unavailable($cfg, 'grok_unavailable', $e->getMessage());
        return;
    }
    if (app_valid_request_id($rid)) {
        app_write_json($cfg['DATA_DIR'] . "/submissions/$rid.finance-" . gmdate('YmdHis') . '.json', $res);
        $res['artifactRef'] = "finance:$rid@" . gmdate('Y-m-d\TH:i:s\Z');
    }
    app_log($cfg, ['event' => 'finance_estimate', 'requestId' => $rid ?: null, 'source' => $res['source'], 'rec' => $res['recommendation']]);
    app_respond(200, ['ok' => true, 'assessment' => $res]);
}
