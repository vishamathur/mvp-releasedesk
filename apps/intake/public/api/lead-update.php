<?php
// Public entry point: no secrets, no logic. Code + config live outside public_html in ~/intake-private/.
declare(strict_types=1);
$home = getenv('HOME') ?: (function_exists('posix_getpwuid') ? (posix_getpwuid(posix_geteuid())['dir'] ?? '') : '');
$private = getenv('INTAKE_PRIVATE_DIR') ?: ($home . '/intake-private');
if (!is_file($private . '/bootstrap.php')) { http_response_code(503); header('Content-Type: application/json'); echo '{"ok":false,"error":"not_configured"}'; exit; }
require $private . '/bootstrap.php';
app_run('api_lead_update');
