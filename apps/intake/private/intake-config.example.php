<?php
// Copy to ~/intake-private/intake-config.php (OUTSIDE public_html), chmod 600. Never commit the real file.
// Environment variables override: GROK_API_KEY, LEAD_HMAC_SECRET, LEAD_WEBHOOK_KEY.
// There is no mock mode. A missing GROK_API_KEY is a configuration error. XAI_API_KEY is not a fallback.
return [
    'GROK_API_KEY'          => '',                      // xAI key; server only
    'GROK_MODEL'            => 'grok-4.20-0309-non-reasoning',   // fast (~1-2 s); 'grok-4.3' or 'grok-4.7' are slower (~15 s)
    'GROK_BASE_URL'         => 'https://api.x.ai/v1',
    'ALLOWED_ORIGINS'       => 'https://intake.vishalmathur.org',
    'PUBLIC_HOST'           => 'intake.vishalmathur.org',
    'RATE_LIMIT_MAX'        => 5,                       // submissions per IP per window
    'RATE_LIMIT_WINDOW_SEC' => 600,
    'CHAT_RATE_LIMIT_MAX'   => 30,                      // chat turns per IP per window
    'RETENTION_DAYS'        => 1,                       // 24 h for submissions, status and events
    'CHAT_DAILY_MAX'        => 3000,                    // assistant calls per day, all visitors
    'CATALOGUE_FILE'        => __DIR__ . '/catalogue.example.json',

    // Release Desk Lead (the only SDLC interface)
    'LEAD_BOT_ID'           => '46e50097-0409-4972-9be0-6ade37563135',
    'LEAD_DELIVERY'         => 'queue',                 // 'queue' (file only) | 'webhook' | 'email'
    'LEAD_WEBHOOK_URL'      => '',                      // Grok Bot routine webhook URL (https)
    'LEAD_WEBHOOK_KEY'      => '',                      // routine secret key
    'LEAD_WEBHOOK_AUTH'     => 'bearer',                // 'bearer' | 'header:X-Name' : confirm from the routine settings
    'LEAD_EMAIL_TO'         => '',                      // Lead's bot inbox, only if LEAD_DELIVERY=email
    'LEAD_EMAIL_FROM'       => 'intake@vishalmathur.org',
    'LEAD_HMAC_SECRET'      => '',                      // master key; on the box the same value is RELEASEDESK_INTAKE_HMAC_SECRET
    'CONTACT_REF_SALT'      => '',                      // >= 32 bytes; salts contactRef. Leave empty here. Do not commit a value.
    'GROK_CHAT_API_KEY'     => '',                      // chat only. Empty means chat refuses. It does not borrow GROK_API_KEY.
    'STYLE_SIG_SECRET'      => '',                      // optional. When set, style signatures use it instead of the derived style key.
];
