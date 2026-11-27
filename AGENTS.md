# Release Desk — Cursor agent instructions (SpaceXAI)

## Product
Northwind Bank KYC release readiness. Desk on `:3002`, KYC on `:3000`.

## Required stack (do not skip)
1. **Grok Bot host** packs in `grok-bots/bots/*` (Lead + Change Analyst + Standards + Security + Builder). The five bots are teammates in the **Grok Bot app** (created 2026-11-18). Ids are `grokBotAppAgentId` in `grok-bots/registry.json` with `host: "grok-bot-app"` and `status: "created_in_grok_bot_app"`. They are not xAI Agents API ids (`liveBotId` stays null). Do not call `api.x.ai` with them. App bots do not take API keys. See `grok-bots/README.md`. Release Desk Log is a sixth teammate (`definitionId` `log`) that only records handoff copies. It is not a handoff sender or recipient and it does not take an API key.
2. **Cursor cloud agent** under Builder: Builder launches one cloud agent on the repo. That agent ships the change and opens a pull request. It does not merge. There is no mock mode. A missing exclusive Cursor key throws a configuration error. CI does not launch cloud agents and does not open pull requests.
3. **Grok API** called by shipped Desk module `apps/releasedesk/src/lib/grok-release-intel.ts` (**classify + summarize + riskTier + blockers** + trustCheck). Builder copies that result into `build-result.testsSummary`. Security uses `riskTier` and `blockers` at the test gate; an open blocker sends the request back to build.

## Spine to preserve
- Iteration gate: Security's security-compliance-approval, raised in Security's chat. `evaluateIterationProceedGate` in core (`checkpoint-gate.ts`) still requires a human `red_team` or `security` sign-off. The Desk does not approve it. The only red-team provider is `grok-guardrails` (fixed probes through the guarded Grok config; needs `RELEASEDESK_GROK_API_KEY_SECURITY`).
- No mocks, no fallbacks, no skips: every external call either works for real or fails with a clear error.
- Grok chat completions send the shared `guidelines` (nsfw, violence, and profanity set to `decline`) and a SHA-256 `safety_identifier`. See `docs/security/grok-guardrails.md`. A 400 or 422 is a hard failure.
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

There is no mock mode and no `RELEASEDESK_CLOUD_CLIENT` switch. A live Cursor dispatch uses the exclusive key for that agent. CI does not hold those keys.

`XAI_API_KEY` / `GROK_API_KEY` / `CURSOR_API_KEY` are **never** used. An absent exclusive key is a configuration error. Missing Lead key does not borrow Builder’s key, and the reverse is also true.

The OWASP review workflow (`.github/workflows/owasp-review.yml`) prefers `RELEASEDESK_GROK_API_KEY_SECURITY`. When that secret is unset it uses `RELEASEDESK_GROK_API_KEY_LEAD`. The report records `keyEnvVar` and never the value. Shared `XAI_API_KEY` / `GROK_API_KEY` are still never used. See `docs/security/owasp-review.md`.

## Verify
```bash
npm run test:desk
npm run test:core
```
