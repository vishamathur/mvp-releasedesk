<?php
declare(strict_types=1);
/* Visitor-facing assistant: guides the visitor and drafts the structured intake. It cannot submit,
 * quote final prices or approve; submission goes to Release Desk Lead via api/intake.php. */

const CHAT_DRAFT_FIELDS = ['contactName', 'email', 'company', 'customerId', 'projectRef', 'changeType', 'legalName', 'jurisdiction', 'intendedProduct', 'sponsor', 'title', 'description', 'urgency', 'desiredBy'];

function chat_schema(array $serviceIds): array {
    $draftProps = [];
    foreach (CHAT_DRAFT_FIELDS as $f) $draftProps[$f] = ['type' => ['string', 'null'], 'maxLength' => $f === 'description' ? 2000 : 150];
    return [
        'type' => 'object', 'additionalProperties' => false,
        'required' => ['reply', 'route', 'draft', 'missingFields', 'readyToSubmit', 'suggestedServiceIds', 'suspectedPromptInjection'],
        'properties' => [
            'reply' => ['type' => 'string', 'maxLength' => 1200],
            'route' => ['type' => 'string', 'enum' => ['new_customer', 'er', 'unknown']],
            'draft' => ['type' => 'object', 'additionalProperties' => false, 'required' => CHAT_DRAFT_FIELDS, 'properties' => $draftProps],
            'missingFields' => ['type' => 'array', 'maxItems' => 14, 'items' => ['type' => 'string', 'enum' => CHAT_DRAFT_FIELDS]],
            'readyToSubmit' => ['type' => 'boolean'],
            'suggestedServiceIds' => ['type' => 'array', 'maxItems' => 6, 'items' => ['type' => 'string', 'enum' => $serviceIds]],
            'suspectedPromptInjection' => ['type' => 'boolean'],
        ],
    ];
}

function chat_system_prompt(array $cat): string {
    $menu = implode("\n", array_map(fn($s) => "- {$s['id']}: {$s['name']} (INR {$s['unitPriceInr']} per {$s['unit']})", array_values($cat['byId'])));
    return "You are the public intake assistant on intake.vishalmathur.org for Release Desk. Release Desk Lead (a bot) is the single interface to the delivery lifecycle; you only help the visitor prepare a request for Lead.\n"
        . "Two options: (1) new_customer: a new customer or new product (fields: contactName, email, company, legalName, jurisdiction, intendedProduct, sponsor, title, description, urgency). "
        . "(2) er: Enhancement Request acceptance for an existing customer/project (fields: contactName, email, company, customerId, projectRef, changeType enhancement|defect|regulatory, title, description, urgency standard|expedited|critical, desiredBy YYYY-MM-DD optional).\n"
        . "Ask for missing fields a few at a time, in plain friendly language. Fill draft only with what the visitor actually said (null otherwise). Set readyToSubmit when all required fields for the route are present; then tell them to review the form and press Submit.\n"
        . "You may mention EXAMPLE catalogue services and list prices below as indicative only. Never give a final quote, timeline promise, discount or approval: Lead posts estimates and the next approval step on the status page, and people make every approval.\n"
        . "EXAMPLE catalogue (INR, excl. GST):\n$menu\n" . GROK_UNTRUSTED_RULES;
}

function api_chat(array $cfg): void {
    [$body, $err] = app_read_json($cfg);
    if ($err) { app_respond(...$err); return; }
    [$ok, $retry] = app_rate_limit($cfg, 'chat', app_client_ip(), (int)($cfg['CHAT_RATE_LIMIT_MAX'] ?? 30), 600);
    if (!$ok) { app_respond(429, ['ok' => false, 'error' => 'rate_limited', 'message' => 'Please slow down and try again in a few minutes.'], ['Retry-After' => (string)$retry]); return; }
    $msgs = [];
    foreach (array_slice(is_array($body['messages'] ?? null) ? $body['messages'] : [], -12) as $m) {
        $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'visitor';
        // Data minimisation: contact details typed into chat are not sent to the model.
        $c = preg_replace(['/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', '/\+?\d[\d\s().-]{8,}\d/'], ['[email given - type it in the form]', '[phone hidden]'], app_clean($m['content'] ?? '', 1500)) ?? '';
        if ($c !== '') $msgs[] = "$role: $c";
    }
    if (!$msgs) { app_respond(400, ['ok' => false, 'error' => 'validation', 'fields' => ['messages']]); return; }
    $route = in_array($body['route'] ?? '', ['new_customer', 'er'], true) ? $body['route'] : 'unknown';
    $cat = catalogue_load($cfg);
    try {
        if (trim((string)($cfg['GROK_API_KEY'] ?? '')) === '') {
            throw new RuntimeException('GROK_API_KEY is not set. Refusing to invent a chat reply.');
        }
        $out = grok_json($cfg, chat_system_prompt($cat), "Selected option: $route\n<visitor_input>\n" . implode("\n", $msgs) . "\n</visitor_input>", 'intake_chat', chat_schema(array_keys($cat['byId'])), 900);
    } catch (Throwable $e) {
        $why = $e->getMessage();
        if (!str_contains($why, 'Refusing to invent')) {
            $why = 'Grok chat failed (' . $why . '). Refusing to invent a chat reply.';
        }
        app_log($cfg, ['event' => 'chat_unavailable', 'reason' => substr($why, 0, 80)]);
        app_respond(503, ['ok' => false, 'error' => 'grok_unavailable', 'message' => $why]);
        return;
    }
    $draft = [];
    foreach (CHAT_DRAFT_FIELDS as $f) if (is_string($out['draft'][$f] ?? null) && trim($out['draft'][$f]) !== '') $draft[$f] = app_clean($out['draft'][$f], $f === 'description' ? 2000 : 150);
    if (isset($draft['changeType']) && !in_array($draft['changeType'], ['enhancement', 'defect', 'regulatory'], true)) unset($draft['changeType']);
    if (isset($draft['urgency']) && !array_key_exists($draft['urgency'], FIN_URGENCY)) unset($draft['urgency']);
    $services = [];
    foreach ($out['suggestedServiceIds'] as $id) if (isset($cat['byId'][$id])) $services[] = ['id' => $id, 'name' => $cat['byId'][$id]['name'], 'unitPriceInr' => $cat['byId'][$id]['unitPriceInr'], 'unit' => $cat['byId'][$id]['unit']];
    app_respond(200, ['ok' => true, 'reply' => app_clean($out['reply'], 1200), 'route' => $out['route'], 'draft' => (object)$draft,
        'missingFields' => array_values(array_intersect($out['missingFields'], CHAT_DRAFT_FIELDS)), 'readyToSubmit' => (bool)$out['readyToSubmit'], 'suggestedServices' => $services]);
}
