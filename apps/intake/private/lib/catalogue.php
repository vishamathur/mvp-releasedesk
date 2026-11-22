<?php
declare(strict_types=1);

function catalogue_load(array $cfg): array {
    static $cache = [];
    $file = $cfg['CATALOGUE_FILE'];
    if (isset($cache[$file])) return $cache[$file];
    $c = json_decode((string)@file_get_contents($file), true);
    if (!is_array($c) || empty($c['services'])) throw new RuntimeException('catalogue_unavailable');
    $byId = [];
    foreach ($c['services'] as $s) {
        foreach (['id', 'name', 'unit', 'unitPriceInr', 'effortDays', 'riskMultiplier'] as $k) if (!isset($s[$k])) throw new RuntimeException("catalogue_bad_entry_$k");
        if ($s['unitPriceInr'] < 0 || $s['riskMultiplier'] < 1 || $s['riskMultiplier'] > 2) throw new RuntimeException('catalogue_bad_values');
        $byId[$s['id']] = $s;
    }
    $c['byId'] = $byId;
    return $cache[$file] = $c;
}

/** Public view for the website (same data, no internal fields). */
function catalogue_public(array $cfg): array {
    $c = catalogue_load($cfg);
    return [
        'label' => $c['label'], 'currency' => $c['currency'], 'taxNote' => $c['taxNote'] ?? '', 'version' => $c['version'] ?? '',
        'services' => array_map(fn($s) => array_intersect_key($s, array_flip(['id', 'name', 'description', 'unit', 'unitPriceInr', 'effortDays', 'riskMultiplier'])), array_values($c['byId'])),
    ];
}

function api_catalogue(array $cfg): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { app_respond(405, ['ok' => false, 'error' => 'method_not_allowed']); return; }
    app_respond(200, ['ok' => true] + catalogue_public($cfg), ['Cache-Control' => 'public, max-age=300']);
}
