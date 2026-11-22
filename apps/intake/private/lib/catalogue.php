<?php
declare(strict_types=1);

/**
 * Catalogue shape is append-only.
 * services[] are priced building blocks (add another, such as SVC-WEB, here).
 * enhancements[] are existing applications. Each one's options[] is an open list.
 * newApplications[] are templates. addOns[] is the same option shape without targetServiceId.
 * An option is {id, name, description, billOfMaterials:[{serviceId, qty}], targetServiceId?}.
 * Adding a small option does not require a code change.
 */

const CATALOGUE_NEW_APP_REQUIRED = ['SVC-DISC', 'SVC-SEC', 'SVC-REL'];

function catalogue_load(array $cfg): array {
    static $cache = [];
    $file = $cfg['CATALOGUE_FILE'];
    if (isset($cache[$file])) return $cache[$file];
    $raw = json_decode((string)@file_get_contents($file), true);
    if (!is_array($raw)) throw new RuntimeException('catalogue_unavailable');
    return $cache[$file] = catalogue_index($raw);
}

/** Strict index. Throws on a bad entry. Safe to call on a raw decoded catalogue. */
function catalogue_index(array $c): array {
    foreach (['label', 'currency', 'version', 'services', 'enhancements', 'newApplications'] as $k) {
        if (!isset($c[$k]) || $c[$k] === '' || $c[$k] === []) {
            if ($k === 'enhancements' || $k === 'newApplications') {
                if (!isset($c[$k]) || !is_array($c[$k])) throw new RuntimeException("catalogue_bad_entry_$k");
            } elseif (!isset($c[$k]) || $c[$k] === '' || !is_array($c[$k])) {
                throw new RuntimeException("catalogue_bad_entry_$k");
            }
        }
    }
    if (!is_array($c['services']) || $c['services'] === []) throw new RuntimeException('catalogue_bad_entry_services');
    if (!str_contains((string)$c['label'], 'EXAMPLE DATA - illustrative prices only')) {
        throw new RuntimeException('catalogue_bad_label');
    }
    $seen = [];
    $byId = [];
    foreach ($c['services'] as $s) {
        if (!is_array($s)) throw new RuntimeException('catalogue_bad_entry_service');
        foreach (['id', 'name', 'description', 'unit', 'unitPriceInr', 'effortDays', 'riskMultiplier'] as $k) {
            if (!isset($s[$k]) || $s[$k] === '') throw new RuntimeException("catalogue_bad_entry_$k");
        }
        catalogue_take_id($seen, (string)$s['id'], 'service');
        if (!is_int($s['unitPriceInr']) || $s['unitPriceInr'] < 0) throw new RuntimeException('catalogue_bad_values');
        if (!is_numeric($s['effortDays']) || $s['effortDays'] < 0) throw new RuntimeException('catalogue_bad_values');
        if (!is_numeric($s['riskMultiplier']) || $s['riskMultiplier'] < 1 || $s['riskMultiplier'] > 2) throw new RuntimeException('catalogue_bad_values');
        $byId[$s['id']] = $s;
    }
    $optionById = [];
    $enhancements = [];
    foreach ($c['enhancements'] as $app) {
        if (!is_array($app)) throw new RuntimeException('catalogue_bad_entry_enhancement');
        foreach (['id', 'name', 'description', 'options'] as $k) {
            if (!isset($app[$k]) || $app[$k] === '') throw new RuntimeException("catalogue_bad_entry_enhancement_$k");
        }
        catalogue_take_id($seen, (string)$app['id'], 'enhancement');
        if (!is_array($app['options'])) throw new RuntimeException('catalogue_bad_entry_enhancement_options');
        $options = [];
        foreach ($app['options'] as $opt) {
            $options[] = catalogue_option($opt, 'PID-ER', $seen, $byId, $app['id'], true);
        }
        $app['options'] = $options;
        $enhancements[] = $app;
        foreach ($options as $opt) $optionById[$opt['id']] = $opt;
    }
    $newApplications = [];
    foreach ($c['newApplications'] as $app) {
        if (!is_array($app)) throw new RuntimeException('catalogue_bad_entry_new_application');
        foreach (['id', 'name', 'description', 'billOfMaterials'] as $k) {
            if (!isset($app[$k]) || $app[$k] === '') throw new RuntimeException("catalogue_bad_entry_new_application_$k");
        }
        catalogue_take_id($seen, (string)$app['id'], 'new_application');
        $bom = catalogue_bom($app['billOfMaterials'], $byId, $app['id']);
        $have = array_column($bom, 'serviceId');
        foreach (CATALOGUE_NEW_APP_REQUIRED as $need) {
            if (!in_array($need, $have, true)) throw new RuntimeException('catalogue_new_app_missing:' . $app['id'] . ':' . $need);
        }
        $addOns = [];
        $addOnsById = [];
        foreach ($app['addOns'] ?? [] as $add) {
            $parsed = catalogue_option($add, 'PID-NC', $seen, $byId, $app['id'], false);
            $addOns[] = $parsed;
            $addOnsById[$parsed['id']] = $parsed;
        }
        $optionById[$app['id']] = [
            'id' => $app['id'],
            'name' => $app['name'],
            'description' => $app['description'],
            'pid' => 'PID-NC',
            'billOfMaterials' => $bom,
            'addOnsById' => $addOnsById,
        ];
        $app['billOfMaterials'] = $bom;
        $app['addOns'] = $addOns;
        $newApplications[] = $app;
    }
    $c['services'] = array_values($byId);
    $c['enhancements'] = $enhancements;
    $c['newApplications'] = $newApplications;
    $c['byId'] = $byId;
    $c['optionById'] = $optionById;
    return $c;
}

function catalogue_take_id(array &$seen, string $id, string $where): void {
    if (!preg_match('/^[A-Z][A-Z0-9-]{1,40}$/', $id)) throw new RuntimeException("catalogue_bad_id:$id");
    if (isset($seen[$id])) throw new RuntimeException("catalogue_duplicate_id:$id");
    $seen[$id] = $where;
}

function catalogue_bom(array $rows, array $services, string $where): array {
    if ($rows === []) throw new RuntimeException("catalogue_empty_bom:$where");
    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) throw new RuntimeException("catalogue_bad_bom:$where");
        $sid = (string)($row['serviceId'] ?? '');
        if (!isset($services[$sid])) throw new RuntimeException("catalogue_unknown_service:$sid");
        $qty = $row['qty'] ?? null;
        if (!is_int($qty) || $qty < 1) throw new RuntimeException("catalogue_bad_qty:$where");
        $out[] = ['serviceId' => $sid, 'qty' => $qty];
    }
    return $out;
}

function catalogue_option(array $opt, string $pid, array &$seen, array $services, string $parentId, bool $needsTarget): array {
    if (!is_array($opt)) throw new RuntimeException('catalogue_bad_entry_option');
    foreach (['id', 'name', 'description', 'billOfMaterials'] as $k) {
        if (!isset($opt[$k]) || $opt[$k] === '') throw new RuntimeException("catalogue_bad_entry_option_$k");
    }
    catalogue_take_id($seen, (string)$opt['id'], 'option');
    $target = null;
    if ($needsTarget) {
        $target = (string)($opt['targetServiceId'] ?? '');
        if (!isset($services[$target])) throw new RuntimeException('catalogue_unknown_service:' . $target);
    }
    return [
        'id' => $opt['id'],
        'name' => $opt['name'],
        'description' => $opt['description'],
        'pid' => $pid,
        'parentId' => $parentId,
        'targetServiceId' => $target,
        'billOfMaterials' => catalogue_bom($opt['billOfMaterials'], $services, $opt['id']),
        'addOnsById' => [],
    ];
}

function catalogue_require_option(array $cfg, string $optionId): array {
    $cat = catalogue_load($cfg);
    $opt = $cat['optionById'][$optionId] ?? null;
    if (!$opt) throw new RuntimeException('Unknown catalogue option "' . $optionId . '".');
    return $opt;
}

/** @param list<string> $addOnIds */
function catalogue_option_lines(array $cfg, string $optionId, array $addOnIds, string $pid): array {
    $opt = catalogue_require_option($cfg, $optionId);
    if ($opt['pid'] !== $pid) {
        throw new RuntimeException('Catalogue option "' . $optionId . '" is ' . $opt['pid'] . ', not ' . $pid . '.');
    }
    $lines = $opt['billOfMaterials'];
    $seen = [];
    foreach ($addOnIds as $id) {
        if (!is_string($id) || $id === '') throw new RuntimeException('Unknown add-on for catalogue option "' . $optionId . '".');
        if (isset($seen[$id])) throw new RuntimeException('Add-on "' . $id . '" was sent more than once.');
        $seen[$id] = true;
        $add = $opt['addOnsById'][$id] ?? null;
        if (!$add) throw new RuntimeException('Unknown add-on "' . $id . '" for catalogue option "' . $optionId . '".');
        foreach ($add['billOfMaterials'] as $row) $lines[] = $row;
    }
    return $lines;
}

function catalogue_expand_lines(array $services, array $bom): array {
    $out = [];
    foreach ($bom as $row) {
        $s = $services[$row['serviceId']];
        $out[] = [
            'serviceId' => $s['id'],
            'name' => $s['name'],
            'qty' => $row['qty'],
            'unitPriceInr' => $s['unitPriceInr'],
            'riskMultiplier' => $s['riskMultiplier'],
            'effortDays' => $s['effortDays'],
        ];
    }
    return $out;
}

/** Public view. Prices stay labelled as example data. */
function catalogue_public(array $cfg): array {
    $c = catalogue_load($cfg);
    $services = array_map(
        fn($s) => array_intersect_key($s, array_flip(['id', 'name', 'description', 'unit', 'unitPriceInr', 'effortDays', 'riskMultiplier'])),
        array_values($c['byId'])
    );
    $enhancements = [];
    foreach ($c['enhancements'] as $app) {
        $options = [];
        foreach ($app['options'] as $opt) {
            $lines = catalogue_expand_lines($c['byId'], $opt['billOfMaterials']);
            $options[] = [
                'id' => $opt['id'],
                'name' => $opt['name'],
                'description' => $opt['description'],
                'targetServiceId' => $opt['targetServiceId'],
                'billOfMaterials' => $opt['billOfMaterials'],
                'lines' => $lines,
                'exampleEstimate' => finance_estimate($cfg, $opt['billOfMaterials']),
            ];
        }
        $enhancements[] = [
            'id' => $app['id'],
            'name' => $app['name'],
            'description' => $app['description'],
            'options' => $options,
        ];
    }
    $newApplications = [];
    foreach ($c['newApplications'] as $app) {
        $addOns = [];
        foreach ($app['addOns'] as $add) {
            $addOns[] = [
                'id' => $add['id'],
                'name' => $add['name'],
                'description' => $add['description'],
                'billOfMaterials' => $add['billOfMaterials'],
                'lines' => catalogue_expand_lines($c['byId'], $add['billOfMaterials']),
            ];
        }
        $newApplications[] = [
            'id' => $app['id'],
            'name' => $app['name'],
            'description' => $app['description'],
            'billOfMaterials' => $app['billOfMaterials'],
            'lines' => catalogue_expand_lines($c['byId'], $app['billOfMaterials']),
            'exampleEstimate' => finance_estimate($cfg, $app['billOfMaterials']),
            'addOns' => $addOns,
        ];
    }
    return [
        'label' => $c['label'],
        'currency' => $c['currency'],
        'taxNote' => $c['taxNote'] ?? '',
        'version' => $c['version'] ?? '',
        'pricing' => [
            'contingencyBasePct' => FIN_POLICY['contingencyBasePct'],
            'contingencyHighRiskPct' => FIN_POLICY['contingencyHighRiskPct'],
            'contingencyCriticalPct' => FIN_POLICY['contingencyCriticalPct'],
            'highRiskThreshold' => FIN_POLICY['highRiskThreshold'],
            'bandLowPct' => FIN_POLICY['bandLowPct'],
            'bandHighPct' => FIN_POLICY['bandHighPct'],
            'roundToInr' => 1000,
            'urgency' => FIN_URGENCY,
        ],
        'services' => $services,
        'enhancements' => $enhancements,
        'newApplications' => $newApplications,
    ];
}

function api_catalogue(array $cfg): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { app_respond(405, ['ok' => false, 'error' => 'method_not_allowed']); return; }
    app_respond(200, ['ok' => true] + catalogue_public($cfg), ['Cache-Control' => 'public, max-age=300']);
}
