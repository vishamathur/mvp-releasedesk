<?php
/**
 * Copy to config.php on the server. Do not commit config.php.
 * lead_webhook is an https endpoint that posts the intake card to Release Desk Lead.
 * Leave it empty to keep cards on disk only.
 */
return [
    'host' => 'intake.vishalmathur.org',
    'lead_bot_id' => '46e50097-0409-4972-9be0-6ade37563135',
    'lead_webhook' => '',
];
