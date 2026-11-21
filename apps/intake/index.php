<?php
declare(strict_types=1);

session_start();
require __DIR__ . '/src/intake.php';

if (empty($_SESSION['intake_csrf'])) {
    $_SESSION['intake_csrf'] = bin2hex(random_bytes(16));
}

$config = intake_load_config(__DIR__);
$host = (string) ($config['host'] ?? 'intake.vishalmathur.org');
$error = '';
$card = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = (string) ($_POST['csrf'] ?? '');
    if (!hash_equals((string) $_SESSION['intake_csrf'], $token)) {
        $error = 'The form expired. Submit it again.';
    } else {
        $input = [
            'relationship' => (string) ($_POST['relationship'] ?? ''),
            'contact_name' => (string) ($_POST['contact_name'] ?? ''),
            'email' => (string) ($_POST['email'] ?? ''),
            'ask' => (string) ($_POST['ask'] ?? ''),
            'customer_id' => (string) ($_POST['customer_id'] ?? ''),
            'product_id' => (string) ($_POST['product_id'] ?? ''),
            'change_type' => (string) ($_POST['change_type'] ?? ''),
            'desired_sprint' => (string) ($_POST['desired_sprint'] ?? ''),
            'legal_name' => (string) ($_POST['legal_name'] ?? ''),
            'jurisdiction' => (string) ($_POST['jurisdiction'] ?? ''),
            'intended_product' => (string) ($_POST['intended_product'] ?? ''),
            'sponsor' => (string) ($_POST['sponsor'] ?? ''),
        ];
        $contact = intake_validate_contact($input);
        $route = $contact['ok'] ? intake_select_route($input) : $contact;
        if (!$route['ok']) {
            $error = (string) $route['error'];
        } else {
            $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
            $requestId = intake_request_id($now);
            $card = intake_build_card($input, $route, $requestId, $now->format(DATE_ATOM), $host);
            $post = intake_post_to_lead($card, intake_lead_webhook($config));
            $card['delivery'] = $post['delivered'] ? 'delivered' : 'recorded';
            $card['deliveryDetail'] = $post['detail'];
            try {
                intake_store_card(__DIR__ . '/storage', $card);
                $_SESSION['intake_csrf'] = bin2hex(random_bytes(16));
            } catch (RuntimeException $e) {
                $card = null;
                $error = 'The request could not be saved. Try again in a moment.';
            }
        }
    }
}

function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

$posted = static function (string $key): string {
    return h((string) ($_POST[$key] ?? ''));
};
$relationship = (string) ($_POST['relationship'] ?? 'existing');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northwind intake</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: #f4f1ea; color: #1c2b24; }
    main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    h1 { font-weight: 500; font-size: 2rem; margin: 0 0 0.5rem; }
    p, label { line-height: 1.45; }
    .lede { color: #3d5348; }
    form, .receipt { background: #fff; border: 1px solid #d9d2c5; padding: 1.25rem; }
    fieldset { border: 0; margin: 0 0 1rem; padding: 0; }
    legend { font-size: 0.95rem; margin-bottom: 0.4rem; }
    label { display: block; margin: 0.8rem 0 0.25rem; font-size: 0.92rem; }
    input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.45rem 0.5rem; border: 1px solid #b7c0b8; background: #fff; }
    textarea { min-height: 7rem; }
    .row { display: flex; gap: 1rem; }
    .row label { font-size: 1rem; }
    button { margin-top: 1rem; font: inherit; background: #1f3d32; color: #f4f1ea; border: 0; padding: 0.6rem 1rem; cursor: pointer; }
    .error { background: #f8e8e4; border: 1px solid #c45b4a; padding: 0.7rem 0.8rem; }
    .muted { color: #5c6b62; font-size: 0.92rem; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em; }
  </style>
</head>
<body>
<main>
  <p class="muted">Northwind Bank · customer intake</p>
  <h1>Request a change</h1>
  <?php if (is_array($card)): ?>
    <section class="receipt">
      <p>Your request is <strong><?= h((string) $card['requestId']) ?></strong>.</p>
      <p>Release Desk Lead will open it on <code><?= h((string) $card['channel']) ?></code> as <?= h((string) $card['pid']) ?>.</p>
      <p class="muted"><?= h((string) ($card['deliveryDetail'] ?? '')) ?> Finance, security, and release are decided later by a person. This page does not approve them.</p>
    </section>
  <?php else: ?>
    <p class="lede">This page is the customer-facing door. It hands the request to Release Desk Lead and stops there.</p>
    <?php if ($error !== ''): ?>
      <p class="error"><?= h($error) ?></p>
    <?php endif; ?>
    <form method="post" action="">
      <input type="hidden" name="csrf" value="<?= h((string) $_SESSION['intake_csrf']) ?>">
      <fieldset>
        <legend>Who is this for?</legend>
        <div class="row">
          <label><input type="radio" name="relationship" value="existing" <?= $relationship !== 'new' ? 'checked' : '' ?>> Existing customer</label>
          <label><input type="radio" name="relationship" value="new" <?= $relationship === 'new' ? 'checked' : '' ?>> New customer</label>
        </div>
      </fieldset>
      <label for="contact_name">Your name</label>
      <input id="contact_name" name="contact_name" required value="<?= $posted('contact_name') ?>">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required value="<?= $posted('email') ?>">
      <label for="customer_id">Customer id <span class="muted">(existing)</span></label>
      <input id="customer_id" name="customer_id" value="<?= $posted('customer_id') ?>">
      <label for="product_id">Product id <span class="muted">(existing)</span></label>
      <input id="product_id" name="product_id" value="<?= $posted('product_id') ?>">
      <label for="change_type">Change type <span class="muted">(existing)</span></label>
      <select id="change_type" name="change_type">
        <?php foreach (['enhancement' => 'Enhancement', 'defect' => 'Defect', 'regulatory' => 'Regulatory tweak'] as $value => $label): ?>
          <option value="<?= h($value) ?>" <?= $posted('change_type') === $value ? 'selected' : '' ?>><?= h($label) ?></option>
        <?php endforeach; ?>
      </select>
      <label for="desired_sprint">Desired sprint <span class="muted">(existing, optional)</span></label>
      <input id="desired_sprint" name="desired_sprint" value="<?= $posted('desired_sprint') ?>">
      <label for="legal_name">Legal name <span class="muted">(new customer)</span></label>
      <input id="legal_name" name="legal_name" value="<?= $posted('legal_name') ?>">
      <label for="jurisdiction">Jurisdiction <span class="muted">(new customer)</span></label>
      <input id="jurisdiction" name="jurisdiction" value="<?= $posted('jurisdiction') ?>">
      <label for="intended_product">Intended product <span class="muted">(new customer)</span></label>
      <input id="intended_product" name="intended_product" value="<?= $posted('intended_product') ?>">
      <label for="sponsor">Internal sponsor <span class="muted">(new customer)</span></label>
      <input id="sponsor" name="sponsor" value="<?= $posted('sponsor') ?>">
      <label for="ask">What do you need?</label>
      <textarea id="ask" name="ask" required><?= $posted('ask') ?></textarea>
      <button type="submit">Send to Release Desk Lead</button>
      <p class="muted">Existing customers follow the sprint process. New customers start with onboarding, not the current sprint.</p>
    </form>
  <?php endif; ?>
</main>
</body>
</html>
