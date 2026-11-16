# Release Desk — Cursor agent instructions (SpaceXAI)

## Product
Northwind Bank KYC release readiness. Desk on `:3001`, KYC on `:3000`.

## Required stack (do not skip)
1. **Grok Bot host** packs in `grok-bots/bots/*` (Lead + Change Analyst + Standards + Security + Builder).
2. **Cursor cloud agent** ships real repo code (this file + skills/rules guide you).
3. **Grok API** called by shipped Desk path `apps/releasedesk/src/lib/grok-release-intel.ts` (classify/extract/score/summarize).

## Spine to preserve
- Per-iteration gate: `evaluateIterationProceedGate` / `checkpoint-gate.ts` — needs `red_team` OR `security` sign-off (`IterationApprovalGate` in Desk).
- ATLAS/OWASP merge hard-block for review-ready PRs (drafts exempt).
- Human merge + release gates — never auto-merge.

## When launched as Coding agent
Follow `.cursor/skills/ship-grok-release-intel/SKILL.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
Prefer extending the Grok intel path over new parallel stacks. Label MOCK when `XAI_API_KEY` absent.

## Verify
```bash
npm run test:desk
npm run test:core
```
