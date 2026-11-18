# Release Desk — Cursor agent instructions (SpaceXAI)

## Product
Northwind Bank KYC release readiness. Desk on `:3002`, KYC on `:3000`.

## Required stack (do not skip)
1. **Grok Bot host** packs in `grok-bots/bots/*` (Lead + Change Analyst + Standards + Security + Builder).
2. **Cursor cloud agents** under Builder: **Coding** (ships code) → **Testing** ∥ **Review** (verify/review; never merge).
3. **Grok API** called by shipped Desk module `apps/releasedesk/src/lib/grok-release-intel.ts` (**classify + summarize** + trustCheck) — Coding owns this ship path.

## Spine to preserve
- Per-iteration gate: `evaluateIterationProceedGate` / `checkpoint-gate.ts` — needs `red_team` OR `security` sign-off (`IterationApprovalGate` in Desk).
- ATLAS/OWASP merge hard-block for review-ready PRs (drafts exempt).
- Human merge + release gates — never auto-merge.

## When launched as Coding agent
Follow `.cursor/skills/ship-grok-release-intel/SKILL.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
Prefer extending the Grok intel path over new parallel stacks.

### Exclusive keys (no shared fallback)
| Agent | Env |
| --- | --- |
| Live Grok intel (Lead) | `RELEASEDESK_GROK_API_KEY_LEAD` |
| Coding Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_CODING` |
| Testing Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_TESTING` |
| Review Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_REVIEW` |

Live Coding dispatch also needs `RELEASEDESK_CLOUD_CLIENT=real`.

`XAI_API_KEY` / `GROK_API_KEY` / `CURSOR_API_KEY` are **never** used. Absent exclusive key → **MOCK** labeled for that agent.

## Verify
```bash
npm run test:desk
npm run test:core
```
