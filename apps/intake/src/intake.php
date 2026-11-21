<?php
/**
 * Customer-facing intake for intake.vishalmathur.org.
 *
 * Builds the card Release Desk Lead consumes. Does not approve a gate.
 */

const INTAKE_LEAD_BOT_ID = '46e50097-0409-4972-9be0-6ade37563135';
const INTAKE_PID_VERSION = '1.0.0';

/**
 * @param array<string, string> $input
 * @return array{ok: true, pid: string, channel: string, version: string}|array{ok: false, error: string}
 */
function intake_select_route(array $input): array
{
    $relationship = trim($input['relationship'] ?? '');
    if ($relationship === 'existing') {
        if (trim($input['customer_id'] ?? '') === '' || trim($input['product_id'] ?? '') === '') {
            return ['ok' => false, 'error' => 'An existing customer needs a customer id and a product id.'];
        }
        $change = trim($input['change_type'] ?? '');
        if (!in_array($change, ['enhancement', 'defect', 'regulatory'], true)) {
            return ['ok' => false, 'error' => 'Choose enhancement, defect, or regulatory tweak.'];
        }
        return [
            'ok' => true,
            'pid' => 'PID-ER',
            'channel' => '#er-intake',
            'version' => INTAKE_PID_VERSION,
        ];
    }
    if ($relationship === 'new') {
        if (trim($input['legal_name'] ?? '') === ''
            || trim($input['jurisdiction'] ?? '') === ''
            || trim($input['intended_product'] ?? '') === ''
            || trim($input['sponsor'] ?? '') === '') {
            return ['ok' => false, 'error' => 'A new customer needs legal name, jurisdiction, intended product, and a sponsor.'];
        }
        return [
            'ok' => true,
            'pid' => 'PID-NC',
            'channel' => '#new-customer',
            'version' => INTAKE_PID_VERSION,
        ];
    }
    return ['ok' => false, 'error' => 'Say whether this is an existing customer or a new customer.'];
}

/**
 * @param array<string, string> $input
 * @return array{ok: true}|array{ok: false, error: string}
 */
function intake_validate_contact(array $input): array
{
    $name = trim($input['contact_name'] ?? '');
    $email = trim($input['email'] ?? '');
    $ask = trim($input['ask'] ?? '');
    if ($name === '') {
        return ['ok' => false, 'error' => 'Enter your name.'];
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Enter a valid email address.'];
    }
    if (strlen($ask) < 12) {
        return ['ok' => false, 'error' => 'Describe the request in a sentence or two.'];
    }
    return ['ok' => true];
}

function intake_request_id(DateTimeInterface $now): string
{
    return 'REQ-' . $now->format('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
}

/**
 * @param array<string, string> $input
 * @param array{pid: string, channel: string, version: string} $route
 * @return array<string, mixed>
 */
function intake_build_card(array $input, array $route, string $requestId, string $submittedAt, string $host): array
{
    $ask = trim($input['ask']);
    $summary = $route['pid'] === 'PID-ER'
        ? sprintf(
            'Existing customer %s, product %s. %s. %s',
            trim($input['customer_id']),
            trim($input['product_id']),
            trim($input['change_type']),
            $ask
        )
        : sprintf(
            'New customer %s (%s). Product %s. Sponsor %s. %s',
            trim($input['legal_name']),
            trim($input['jurisdiction']),
            trim($input['intended_product']),
            trim($input['sponsor']),
            $ask
        );

    return [
        'v' => 1,
        'kind' => 'intake-card',
        'source' => 'customer-facing-intake',
        'host' => $host,
        'pid' => $route['pid'],
        'pidVersion' => $route['version'],
        'requestId' => $requestId,
        'channel' => $route['channel'],
        'to' => 'lead',
        'leadBotId' => INTAKE_LEAD_BOT_ID,
        'submittedAt' => $submittedAt,
        'contact' => [
            'name' => trim($input['contact_name']),
            'email' => trim($input['email']),
        ],
        'customer' => $route['pid'] === 'PID-ER'
            ? [
                'customerId' => trim($input['customer_id']),
                'productId' => trim($input['product_id']),
                'changeType' => trim($input['change_type']),
                'desiredSprint' => trim($input['desired_sprint'] ?? ''),
            ]
            : [
                'legalName' => trim($input['legal_name']),
                'jurisdiction' => trim($input['jurisdiction']),
                'intendedProduct' => trim($input['intended_product']),
                'sponsor' => trim($input['sponsor']),
            ],
        'ask' => $ask,
        'summary' => $summary,
        'humanGate' => null,
        'delivery' => 'recorded',
    ];
}

/**
 * @param array<string, mixed> $config
 */
function intake_lead_webhook(array $config): string
{
    $url = trim((string) ($config['lead_webhook'] ?? ''));
    if ($url === '') {
        return '';
    }
    if (!preg_match('#^https://#', $url)) {
        return '';
    }
    return $url;
}

/**
 * @param array<string, mixed> $card
 * @return array{delivered: bool, detail: string}
 */
function intake_post_to_lead(array $card, string $webhook): array
{
    if ($webhook === '') {
        return ['delivered' => false, 'detail' => 'No Lead webhook configured. Card kept on disk.'];
    }
    $body = json_encode($card, JSON_UNESCAPED_SLASHES);
    if ($body === false) {
        return ['delivered' => false, 'detail' => 'Card could not be encoded.'];
    }
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
            'content' => $body,
            'timeout' => 8,
            'ignore_errors' => true,
        ],
    ]);
    $result = @file_get_contents($webhook, false, $context);
    $status = 0;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) {
                $status = (int) $m[1];
            }
        }
    }
    if ($result === false || $status < 200 || $status >= 300) {
        return ['delivered' => false, 'detail' => 'Lead webhook did not accept the card. It stays on disk.'];
    }
    return ['delivered' => true, 'detail' => 'Lead accepted the intake card.'];
}

/**
 * @param array<string, mixed> $card
 */
function intake_store_card(string $dir, array $card): void
{
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Intake storage is not available.');
    }
    $id = (string) $card['requestId'];
    if (!preg_match('/^REQ-[0-9]{8}-[A-F0-9]{6}$/', $id)) {
        throw new RuntimeException('Refusing to store a card with an unexpected request id.');
    }
    $path = $dir . DIRECTORY_SEPARATOR . $id . '.json';
    $json = json_encode($card, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($path, $json . "\n", LOCK_EX) === false) {
        throw new RuntimeException('Could not store the intake card.');
    }
}

/**
 * @return array<string, mixed>
 */
function intake_load_config(string $root): array
{
    $example = $root . '/config.example.php';
    $local = $root . '/config.php';
    $config = is_file($example) ? require $example : [];
    if (!is_array($config)) {
        $config = [];
    }
    if (is_file($local)) {
        $overlay = require $local;
        if (is_array($overlay)) {
            $config = array_merge($config, $overlay);
        }
    }
    return $config;
}
