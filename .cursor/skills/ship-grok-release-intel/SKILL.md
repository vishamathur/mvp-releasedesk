---
name: ship-grok-release-intel
description: Ship or harden the Desk Grok API release intel call (classify + summarize, json_schema) for the Release Desk SDLC.
---

# Ship Grok release intel

## Goal

`apps/releasedesk` calls `https://api.x.ai/v1/chat/completions` to classify and summarize release findings. The live request uses `response_format` `json_schema`. This is the code the Builder bot's Cursor cloud agent ships.

## Steps

1. Read `AGENTS.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
2. Extend `src/lib/grok-release-intel.ts`, the API route, the panel, and the vitest.
3. Read the app key with `resolveAppGrokApiKey`. The env name is `XAI_API_KEY`. Ignore per-bot `RELEASEDESK_GROK_API_KEY_*` values.
4. Send `GROK_RELEASE_INTEL_JSON_SCHEMA` as `response_format.json_schema`.
5. Keep `trustCheck.humanGateStillRequired` and `trustCheck.noAutoApprove` true.
6. Without `XAI_API_KEY`, return MOCK. Do not invent a live response.
7. Run `npm run test:desk`.
8. Open a pull request. Do not merge. Do not set `RELEASEDESK_CLOUD_CLIENT=real`.

## Acceptance

- Schema-valid JSON (`classify` + `summarize`)
- The request body includes `response_format.type === "json_schema"`
- Trust check (`humanGateStillRequired`, `noAutoApprove`)
- MOCK fallback without `XAI_API_KEY`
- Human gates still required
- The result goes back to Lead as a Grok Bot `build-result` message, not through Desk orchestration
