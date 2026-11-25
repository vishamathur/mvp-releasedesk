# Grok guardrails

Chat completions from Release Desk and the public intake use the documented xAI request fields. The source of the field list is [Custom moderation controls](https://docs.x.ai/developers/advanced-api-usage/custom-moderation-controls) and the [security FAQ](https://docs.x.ai/developers/faq/security).

## What every chat call sends

`packages/releasedesk-core/src/grok-guardrails.ts` builds the body. Specialist calls, Desk release-intel, and the `grok-guardrails` red-team probes use it. The public intake uses the same three guidelines and a hashed `safety_identifier`.

```json
{
  "guidelines": [
    { "type": "policy", "category": "nsfw", "behavior": "decline" },
    { "type": "policy", "category": "violence", "behavior": "decline" },
    { "type": "policy", "category": "profanity", "behavior": "decline" }
  ],
  "safety_identifier": "<sha256 hex of an internal id>"
}
```

`safety_identifier` is a SHA-256 of an internal id: a request id, a run id, or a bot role. It is never an email, phone number, or display name.

The body does not set `stop` or `n`. Multi-agent model ids are rejected before the request is sent. The API rejects those combinations with `400` when guidelines are present.

Calls go only to `https://api.x.ai/v1/chat/completions`, with a 30 second timeout. Keys stay in environment variables or the host secret store and are not written to logs.

A `400` or `422` from a guidelines check is a hard failure. The caller does not invent a result.

Model output stays untrusted. Release intel and the intake finance and chat routes accept it only after strict `json_schema` checks. The intake still flags suspected prompt injection and keeps that case at review or stricter.

## Red-team provider

`grok-guardrails` is the only red-team provider and the default. It runs four fixed prompts (prompt injection, secret exfiltration, policy bypass, unsafe content) through this body. It needs `RELEASEDESK_GROK_API_KEY_SECURITY`. A missing key throws. CI does not call it. Any other provider name, including `zscaler` and `custom`, is a configuration error.

`evaluateIterationProceedGate` still requires a human `red_team` or `security` sign-off. Probe findings do not approve the gate.

## Retention and region

xAI stores API requests and responses for 30 days by default and does not train on them. Zero Data Retention is a team setting in the xAI console. It is not turned on here, because it disables stored Responses, Files, Collections, and the Batch API.

The default host is `https://api.x.ai`. A US regional endpoint, `https://us.api.x.ai/v1`, is documented for teams that need US processing. This repo does not switch to it.

The Agents management call (`POST /v1/agents`) is not a chat completion. Its documented body is `name` and `instructions`, so guidelines are not added there.
