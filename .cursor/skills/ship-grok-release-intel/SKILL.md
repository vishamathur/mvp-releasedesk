---
name: ship-grok-release-intel
description: Ship or harden Desk Grok API release intel (classify/extract/score/summarize) for SpaceXAI challenge.
---

# Ship Grok release intel

## Goal
Ensure `apps/releasedesk` contains a **real workflow** path that calls `https://api.x.ai/v1/chat/completions` to classify, extract, score, and summarize release findings.

## Steps
1. Read `AGENTS.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
2. Implement/extend `src/lib/grok-release-intel.ts` + API route + UI panel + vitest.
3. Wire run page / challenge trigger to call it.
4. Run `npm run test:desk`.
5. Open a PR — never merge.

## Acceptance
- Schema-valid JSON result
- MOCK fallback without key
- Human gates still required
- Iteration gate UI still works
