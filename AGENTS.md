# Release Desk agent notes

## Grok Bot triad (Desk `/mvp`)

Lead · Security · Builder — definitions in `grok-bots/definitions/` and
`packages/releasedesk-core/src/grok-bots/`. Create live via
`npx tsx scripts/setup-grok-bots.ts` (no public Bot create API).

Exclusive keys only: `RELEASEDESK_GROK_API_KEY_*` / `RELEASEDESK_CURSOR_API_KEY_*`.

## One Cursor → Grok API ship

| What | Where |
| --- | --- |
| Shipped module | `packages/releasedesk-specialists/src/grok-api-intel.ts` |
| Demo | `npx tsx scripts/demo-grok-intel.ts` |
| Skill | `.cursor/skills/ship-grok-release-intel/SKILL.md` |
| Key | `RELEASEDESK_GROK_API_KEY_BUILDER` |

## Gates

- Iteration: `evaluateIterationProceedGate` — **red_team \| security**
- Merge/release: human only — Cloud Agents never auto-merge
