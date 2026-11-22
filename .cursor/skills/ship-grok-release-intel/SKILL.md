---
name: ship-grok-release-intel
description: Ship or harden Desk Grok API release intel (classify + summarize) for SpaceXAI challenge.
---

# Ship Grok release intel

## Goal
Ensure `apps/releasedesk` contains a **real workflow** path that calls `https://api.x.ai/v1/chat/completions` to **classify** and **summarize** release findings (with trustCheck). This is the **Coding** Cloud Agent deliverable.

## Steps
1. Read `AGENTS.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
2. Implement/extend `src/lib/grok-release-intel.ts` + `POST /api/grok/release-intel` + vitest.
3. Keep that route as the ship path.
4. Use exclusive `RELEASEDESK_GROK_API_KEY_LEAD` only. A missing key throws.
5. Run `npm run test:desk`.
6. Open a PR — never merge. Testing/Review Cloud Agents may verify/review afterward; they do not merge.

## Acceptance
- Schema-valid JSON (`classify` + `summarize`)
- Trust check (`humanGateStillRequired`, `noAutoApprove`)
- A missing exclusive Lead key throws. There is no stand-in result.
- Human gates still required
- Coding is the ship path; Testing verifies; Review reviews — never merge
