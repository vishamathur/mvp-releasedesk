<?php
// Stand-in for https://api.x.ai/v1/chat/completions. php -S 127.0.0.1:9921 tests/mock-xai.php
$req = json_decode(file_get_contents('php://input'), true);
$log = getenv('MOCK_LOG') ?: '/tmp/mock-xai.log';
$user = $req['messages'][1]['content'] ?? '';
$name = $req['response_format']['json_schema']['name'] ?? '';
file_put_contents($log, json_encode(['path' => $_SERVER['REQUEST_URI'], 'auth' => isset($_SERVER['HTTP_AUTHORIZATION']), 'schema' => $name,
    'strict' => $req['response_format']['json_schema']['strict'] ?? null, 'type' => $req['response_format']['type'] ?? null,
    'model' => $req['model'] ?? null, 'hasEmail' => str_contains($user, '@example.com')]) . "\n", FILE_APPEND);
if (str_contains($user, 'FAIL_GROK')) { http_response_code(503); echo '{}'; exit; }
if ($name === 'finance_assessment') {
    $inj = (bool)preg_match('/ignore previous/i', $user);
    $out = ['lines' => [['serviceId' => 'SVC-UI-S', 'qty' => 2, 'reason' => 'two label changes'], ['serviceId' => 'SVC-BOGUS', 'qty' => 1, 'reason' => 'x'], ['serviceId' => 'SVC-REL', 'qty' => 1, 'reason' => 'release']],
        'mappingConfidence' => 'high', 'recommendation' => $inj ? 'approve-recommended' : 'approve-recommended', 'rationale' => 'Small change.',
        'risks' => [], 'openQuestions' => ['Which screens?'], 'suspectedPromptInjection' => $inj];
    if (str_contains($user, 'GROK_SAYS_REJECT')) $out['recommendation'] = 'reject-suggested';
} else {
    $out = ['reply' => 'Thanks! What is your customer ID?', 'route' => 'er',
        'draft' => ['contactName' => 'Jane Doe', 'email' => null, 'company' => null, 'customerId' => null, 'projectRef' => null, 'changeType' => 'enhancement', 'legalName' => null,
            'jurisdiction' => null, 'intendedProduct' => null, 'sponsor' => null, 'title' => 'Rename labels', 'description' => null, 'urgency' => 'bogus', 'desiredBy' => null],
        'missingFields' => ['customerId', 'email'], 'readyToSubmit' => false, 'suggestedServiceIds' => ['SVC-UI-S', 'SVC-NOPE'], 'suspectedPromptInjection' => false];
}
header('Content-Type: application/json');
echo json_encode(['choices' => [['message' => ['role' => 'assistant', 'content' => json_encode($out)]]]]);
