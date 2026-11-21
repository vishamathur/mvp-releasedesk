<?php
declare(strict_types=1);

require __DIR__ . '/src/intake.php';

$failures = 0;
$check = static function (bool $ok, string $message) use (&$failures): void {
    if ($ok) {
        echo "ok  $message\n";
        return;
    }
    $failures++;
    fwrite(STDERR, "fail  $message\n");
};

$er = intake_select_route([
    'relationship' => 'existing',
    'customer_id' => 'NORTHWIND-014',
    'product_id' => 'kyc',
    'change_type' => 'enhancement',
]);
$check($er['ok'] === true && $er['pid'] === 'PID-ER' && $er['channel'] === '#er-intake', 'existing customer selects PID-ER');

$missing = intake_select_route([
    'relationship' => 'existing',
    'customer_id' => 'NORTHWIND-014',
    'product_id' => '',
    'change_type' => 'enhancement',
]);
$check($missing['ok'] === false, 'existing customer without a product is rejected');

$nc = intake_select_route([
    'relationship' => 'new',
    'legal_name' => 'Contoso Holdings',
    'jurisdiction' => 'Delaware',
    'intended_product' => 'KYC portal',
    'sponsor' => 'A. Sponsor',
]);
$check($nc['ok'] === true && $nc['pid'] === 'PID-NC' && $nc['channel'] === '#new-customer', 'new customer selects PID-NC');

$badContact = intake_validate_contact([
    'contact_name' => '',
    'email' => 'not-an-email',
    'ask' => 'short',
]);
$check($badContact['ok'] === false, 'contact details are required');

$good = [
    'relationship' => 'existing',
    'contact_name' => 'Priya Shah',
    'email' => 'priya@northwind.example',
    'ask' => 'Refresh the address form so a second line is optional.',
    'customer_id' => 'NORTHWIND-014',
    'product_id' => 'kyc',
    'change_type' => 'enhancement',
    'desired_sprint' => '2026-W48',
];
$route = intake_select_route($good);
$id = intake_request_id(new DateTimeImmutable('2026-11-21', new DateTimeZone('UTC')));
$card = intake_build_card($good, $route, $id, '2026-11-21T16:00:00+00:00', 'intake.vishalmathur.org');
$check($card['to'] === 'lead', 'card is addressed to Lead');
$check($card['leadBotId'] === INTAKE_LEAD_BOT_ID, 'card names the Lead bot');
$check($card['humanGate'] === null, 'card does not approve a human gate');
$check($card['kind'] === 'intake-card' && $card['channel'] === '#er-intake', 'card is an ER intake card');
$check(intake_lead_webhook(['lead_webhook' => 'http://example.test/hook']) === '', 'webhook must be https');
$check(intake_lead_webhook(['lead_webhook' => 'https://lead.example/hook']) === 'https://lead.example/hook', 'https webhook is kept');

$dir = sys_get_temp_dir() . '/intake-test-' . bin2hex(random_bytes(4));
intake_store_card($dir, $card);
$saved = json_decode((string) file_get_contents($dir . '/' . $id . '.json'), true);
$check(is_array($saved) && $saved['requestId'] === $id, 'card is stored as json');

echo $failures === 0 ? "passed\n" : "failed $failures\n";
exit($failures === 0 ? 0 : 1);
