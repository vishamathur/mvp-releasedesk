---
name: ship-grok-release-intel
description: Ship or harden the one Cursor→Grok API release intel path (classify/extract/score/summarize).
---

# Ship Grok release intel

## Goal
Keep **one** real workflow path that calls `https://api.x.ai/v1/chat/completions`:

`packages/releasedesk-specialists/src/grok-api-intel.ts`

Uses exclusive `RELEASEDESK_GROK_API_KEY_BUILDER` — never shared `XAI_API_KEY`.

## Steps
1. Read `AGENTS.md` and `grok-bots/README.md`.
2. Harden `grok-api-intel.ts` + `scripts/demo-grok-intel.ts` + vitest.
3. Builder Coding handoff must point at this file.
4. Run `npx tsx scripts/demo-grok-intel.ts` and `npm run test:specialists`.
5. Open a PR — never merge. Iteration gate still needs red_team|security.

## Acceptance
- classify / extract / score / summarize work
- MOCK without Builder key; shared XAI ignored
- Human merge/release gates unchanged
