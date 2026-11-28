<?php
declare(strict_types=1);
/* Visitor-facing assistant: guides the visitor and drafts the structured intake. It cannot submit,
 * quote final prices or approve; submission goes to Release Desk Lead via api/intake.php. */

const CHAT_DRAFT_FIELDS = ['contactName', 'email', 'company', 'customerId', 'projectRef', 'changeType', 'legalName', 'jurisdiction', 'intendedProduct', 'sponsor', 'title', 'description', 'urgency', 'desiredBy',
    'siteName', 'purpose', 'audience', 'pages', 'mustHaveFeatures', 'brandAssets', 'domainHosting', 'budgetBand'];

function chat_draft_max(string $f): int { return $f === 'description' ? 2000 : (in_array($f, ['purpose', 'pages', 'mustHaveFeatures'], true) ? 600 : 150); }

function chat_schema(array $serviceIds): array {
    $draftProps = [];
    foreach (CHAT_DRAFT_FIELDS as $f) $draftProps[$f] = ['type' => ['string', 'null'], 'maxLength' => chat_draft_max($f)];
    return [
        'type' => 'object', 'additionalProperties' => false,
        'required' => ['reply', 'route', 'draft', 'missingFields', 'readyToSubmit', 'suggestedServiceIds', 'suspectedPromptInjection'],
        'properties' => [
            'reply' => ['type' => 'string', 'maxLength' => 1200],
            'route' => ['type' => 'string', 'enum' => ['website', 'new_customer', 'er', 'unknown']],
            'draft' => ['type' => 'object', 'additionalProperties' => false, 'required' => CHAT_DRAFT_FIELDS, 'properties' => $draftProps],
            'missingFields' => ['type' => 'array', 'maxItems' => 24, 'items' => ['type' => 'string', 'enum' => CHAT_DRAFT_FIELDS]],
            'readyToSubmit' => ['type' => 'boolean'],
            'suggestedServiceIds' => ['type' => 'array', 'maxItems' => 6, 'items' => ['type' => 'string', 'enum' => $serviceIds]],
            'suspectedPromptInjection' => ['type' => 'boolean'],
        ],
    ];
}

function chat_system_prompt(array $cat): string {
    $menu = implode("\n", array_map(fn($s) => "- {$s['id']}: {$s['name']} (INR {$s['unitPriceInr']} per {$s['unit']})", array_values($cat['byId'])));
    return "You are the public intake assistant on intake.vishalmathur.org for Release Desk. Release Desk Lead (a bot) is the single interface to the delivery lifecycle; you only help the visitor prepare a request for Lead.\n"
        . "Three options: (0) website: Website creation, the flagship option, which runs the new-project process (fields: contactName, email, company, legalName, jurisdiction, sponsor, siteName, purpose, audience, pages (the pages needed), mustHaveFeatures, brandAssets (content and brand assets), domainHosting, budgetBand under_50k|50k_150k|150k_300k|300k_plus|not_sure, desiredBy YYYY-MM-DD optional, urgency). "
        . "(1) new_customer: a new customer or new product (fields: contactName, email, company, legalName, jurisdiction, intendedProduct, sponsor, title, description, urgency). "
        . "(2) er: Enhancement Request acceptance for an existing customer/project (fields: contactName, email, company, customerId, projectRef, changeType enhancement|defect|regulatory, title, description, urgency standard|expedited|critical, desiredBy YYYY-MM-DD optional).\n"
        . "customerId uses the canonical cust_<slug> form, for example cust_1042, the same form stored on cost records.\n"
        . "Ask for missing fields a few at a time, in plain friendly language. Fill draft only with what the visitor actually said (null otherwise). Set readyToSubmit when all required fields for the route are present; then tell them to review the form and press Submit.\n"
        . "You may mention EXAMPLE catalogue services and list prices below as indicative only. Never give a final quote, timeline promise, discount or approval: Lead posts estimates and the next approval step on the status page, and people make every approval.\n"
        . "EXAMPLE catalogue (INR, excl. GST):\n$menu\n" . GROK_UNTRUSTED_RULES;
}

/** Same denylist as the Cloudflare worker: case-insensitive markup and shorteners, plus a lowercase TLD. */
const CHAT_MARKUP_MAX = 10000;
function chat_markup_re(): string {
    return '/<[^>]*>|https?:\/\/|hxxps?:\/\/|ftp:\/\/|(?<![a-z0-9:])\/\/[a-z0-9]|\bwww\.|javascript:|data:text|[`]|\{\{|\$\(|\]\(|\b(?:bit\.ly|t\.me|tinyurl\.com|goo\.gl|is\.gd|ow\.ly|buff\.ly|cutt\.ly|rb\.gy|t\.co)\b/i';
}
function chat_lower_tld_re(): string {
    return '/\b[A-Za-z0-9-]+\.(?:com|net|org|io|in|co|xyz|ru|top|info|dev|app|ai|me|ly|cc|uk|de|gl|gd|page|site|link|cloud|shop|online)\b/';
}
function chat_markup_input(string $s): string { return substr($s, 0, CHAT_MARKUP_MAX); }
function chat_has_markup(string $s): bool {
    $s = chat_markup_input($s);
    return preg_match(chat_markup_re(), $s) === 1 || preg_match(chat_lower_tld_re(), $s) === 1;
}
function chat_strip_markup(string $s): string {
    $s = preg_replace(chat_markup_re(), '', chat_markup_input($s)) ?? '';
    return preg_replace(chat_lower_tld_re(), '', $s) ?? $s;
}

function chat_redact(string $s): string {
    $s = preg_replace('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', '[email given - type it in the form]', $s) ?? $s;
    $s = preg_replace('/\+?\d[\d\s().-]{8,}\d/', '[number hidden]', $s) ?? $s;
    $s = preg_replace('/\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]\b/', '[gstin hidden]', $s) ?? $s;
    $s = preg_replace('/\b[A-Z]{5}\d{4}[A-Z]\b/', '[tax id hidden]', $s) ?? $s;
    $s = preg_replace('/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/', '[account hidden]', $s) ?? $s;
    return preg_replace('/\b(?:xai|sk|ghp|gho|AKIA)[-_A-Za-z0-9]{16,}\b/', '[secret hidden]', $s) ?? $s;
}

function api_chat(array $cfg): void {
    [$body, $err] = app_read_json($cfg);
    if ($err) {
        if (($err[0] ?? 0) === 413) app_log($cfg, ['event' => 'chat_rejected', 'why' => 'too_large']);
        app_respond(...$err);
        return;
    }
    [$ok, $retry] = app_rate_limit($cfg, 'chat', app_client_ip(), (int)($cfg['CHAT_RATE_LIMIT_MAX'] ?? 30), 600);
    if (!$ok) {
        app_log($cfg, ['event' => 'chat_rejected', 'why' => 'rate_limited']);
        app_respond(429, ['ok' => false, 'error' => 'rate_limited', 'message' => 'Please slow down and try again in a few minutes.'], ['Retry-After' => (string)$retry]);
        return;
    }
    $msgs = [];
    foreach (array_slice(is_array($body['messages'] ?? null) ? $body['messages'] : [], -12) as $m) {
        if (!is_array($m) || ($m['role'] ?? '') !== 'user') continue;
        $c = chat_redact(app_clean($m['content'] ?? '', 1500));
        if ($c !== '') $msgs[] = "visitor: $c";
    }
    if (!$msgs) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => ['messages']]); return; }
    // Charge the global ceiling only after the per-IP limit and message checks.
    [$gok] = app_rate_limit($cfg, 'chat-global-day', 'all', (int)($cfg['CHAT_DAILY_MAX'] ?? 3000), 86400);
    if (!$gok) {
        app_log($cfg, ['event' => 'chat_rejected', 'why' => 'daily_cap']);
        app_respond(429, ['ok' => false, 'error' => 'assistant_busy', 'message' => 'The assistant is busy. Please use the form directly.'], ['Retry-After' => '3600']);
        return;
    }
    $route = in_array($body['route'] ?? '', ['website', 'new_customer', 'er'], true) ? $body['route'] : 'unknown';
    $cat = catalogue_load($cfg);
    try {
        $chatKey = trim((string)($cfg['GROK_CHAT_API_KEY'] ?? ''));
        if ($chatKey === '') throw new RuntimeException('GROK_CHAT_API_KEY is not set. Refusing to invent a chat reply.');
        $out = grok_json(['GROK_API_KEY' => $chatKey] + $cfg, chat_system_prompt($cat), "Selected option: $route\n<visitor_input>\n" . implode("\n", $msgs) . "\n</visitor_input>", 'intake_chat', chat_schema(array_keys($cat['byId'])), app_client_ip(), 900);
    } catch (Throwable $e) {
        $why = $e->getMessage();
        if (!str_contains($why, 'Refusing to invent')) $why = 'Grok chat failed (' . $why . '). Refusing to invent a chat reply.';
        app_log($cfg, ['event' => 'chat_unavailable', 'reason' => substr($why, 0, 80)]);
        app_respond_unavailable($cfg, 'grok_unavailable', $why);
        return;
    }
    $injected = !empty($out['suspectedPromptInjection']);
    $shape = ['email' => '/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/', 'desiredBy' => '/^\d{4}-\d{2}-\d{2}$/'];
    $draft = [];
    if (!$injected) foreach (CHAT_DRAFT_FIELDS as $f) {
        if (!is_string($out['draft'][$f] ?? null) || trim($out['draft'][$f]) === '') continue;
        $v = app_clean($out['draft'][$f], chat_draft_max($f));
        if (chat_has_markup($v)) continue;
        if (isset($shape[$f]) && !preg_match($shape[$f], $v)) continue;
        $draft[$f] = $v;
    }
    if (isset($draft['customerId']) && !preg_match(CUSTOMER_ID_RE, $draft['customerId'])) unset($draft['customerId']);
    if (isset($draft['changeType']) && !in_array($draft['changeType'], ['enhancement', 'defect', 'regulatory'], true)) unset($draft['changeType']);
    if (isset($draft['budgetBand']) && !array_key_exists($draft['budgetBand'], WEBSITE_BUDGET_BANDS)) unset($draft['budgetBand']);
    if (isset($draft['urgency']) && !array_key_exists($draft['urgency'], FIN_URGENCY)) unset($draft['urgency']);
    $services = [];
    if (!$injected) foreach ($out['suggestedServiceIds'] as $id) if (isset($cat['byId'][$id])) $services[] = ['id' => $id, 'name' => $cat['byId'][$id]['name'], 'unitPriceInr' => $cat['byId'][$id]['unitPriceInr'], 'unit' => $cat['byId'][$id]['unit']];
    app_log($cfg, ['event' => 'chat', 'injected' => $injected, 'route' => $out['route'], 'ready' => (bool)$out['readyToSubmit'], 'n' => count($msgs)]);
    $reply = $injected ? "I can only help prepare an intake request, so I haven't filled anything in. Please use the form directly." : chat_strip_markup(app_clean($out['reply'], 1200));
    app_respond(200, ['ok' => true, 'reply' => $reply, 'route' => $injected ? 'unknown' : $out['route'], 'draft' => (object)$draft, 'flagged' => $injected,
        'missingFields' => $injected ? [] : array_values(array_intersect($out['missingFields'], CHAT_DRAFT_FIELDS)), 'readyToSubmit' => $injected ? false : (bool)$out['readyToSubmit'], 'suggestedServices' => $services]);
}
