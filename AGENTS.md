# Release Desk — Cursor agent instructions (SpaceXAI)

## Product
Northwind Bank KYC release readiness. Desk on `:3002`, KYC on `:3000`.

## Required stack (do not skip)
1. **Grok Bot host** packs in `grok-bots/bots/*` (Lead + Change Analyst + Standards + Security + Builder). The five bots are teammates in the **Grok Bot app** (created 2026-11-18). Ids are `grokBotAppAgentId` in `grok-bots/registry.json` with `host: "grok-bot-app"` and `status: "created_in_grok_bot_app"`. They are not xAI Agents API ids (`liveBotId` stays null). Do not call `api.x.ai` with them. App bots do not take API keys. See `grok-bots/README.md`.
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
These keys authenticate **application** calls. They are not Grok Bot app credentials. Set them in `apps/releasedesk/.env.local` (Next.js Desk) or as Cursor Cloud Agent secrets. Never commit values. Template: `.env.example`.

| Agent | Env | Used for |
| --- | --- | --- |
| Lead | `RELEASEDESK_GROK_API_KEY_LEAD` | Desk Grok intel (classify + summarize) |
| Change Analyst | `RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST` | Change Analyst specialist calls |
| Standards | `RELEASEDESK_GROK_API_KEY_STANDARDS` | Standards specialist calls |
| Security | `RELEASEDESK_GROK_API_KEY_SECURITY` | Security specialist calls |
| Builder | `RELEASEDESK_GROK_API_KEY_BUILDER` | Builder specialist calls and specialist intel |
| Coding Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_CODING` | Cursor Coding dispatch |
| Testing Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_TESTING` | Cursor Testing dispatch |
| Review Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_REVIEW` | Cursor Review dispatch |

Live Coding dispatch also needs `RELEASEDESK_CLOUD_CLIENT=real`.

`XAI_API_KEY` / `GROK_API_KEY` / `CURSOR_API_KEY` are **never** used. Absent exclusive key → **MOCK** labeled for that agent. Missing Lead key does not borrow Builder’s key, and the reverse is also true.

## Verify
```bash
npm run test:desk
npm run test:core
```
