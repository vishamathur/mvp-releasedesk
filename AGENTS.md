# Release Desk — Cursor agent instructions (SpaceXAI)

## Product

Northwind Bank KYC release readiness. Desk on `:3002`, KYC on `:3000`.

## Required stack

1. **Grok Bot host** packs in `grok-bots/bots/*` (Lead, Change Analyst, Standards, Security, Builder). The five bots are teammates in the **Grok Bot app**. Ids are `grokBotAppAgentId` in `grok-bots/registry.json` with `host: "grok-bot-app"` and `status: "created_in_grok_bot_app"`. They are not xAI Agents API ids (`liveBotId` stays null). Do not call `api.x.ai` with them. App bots do not take API keys. The SDLC handoff runs in the Grok Bot app (teammates, channels, routines, skills, memory). Desk does not orchestrate it. See `grok-bots/README.md` and `docs/sdlc/overview.md`.
2. **Cursor cloud agent** launched by the Builder bot for the build stage, guided by `.cursor/rules` and `.cursor/skills`. Desk does not launch it. Do not set `RELEASEDESK_CLOUD_CLIENT=real`.
3. **Grok API** called by shipped module `apps/releasedesk/src/lib/grok-release-intel.ts` (classify + summarize, `json_schema`, trustCheck). One app key: `XAI_API_KEY`.

## Processes

- `PID-ER` v1.0.0 — enhancement for an existing customer. Fixed sprint. `#er-intake`.
- `PID-NC` v1.0.0 — full product request for a new customer. Kickoff first, plus onboarding, discovery, scope, a customer-approved proposal, and a phased estimate. `#new-customer`.

Both pass intake, estimation, finance approval, security and compliance approval, build, test gate, and release gate. Specs: `grok-bots/processes/`.

## Spine to preserve

- Iteration gate: a human `red_team` OR `security` signature (`evaluateIterationProceedGate` / `checkpoint-gate.ts`). Security is mandatory on every change. No bot signs the gate.
- Finance approval, security/compliance sign-off, and release go/no-go are human decisions in the request thread. PID-NC proposal is approved by the customer sponsor. No auto-approve on demo paths.
- ATLAS/OWASP merge hard-block for review-ready PRs (drafts exempt).
- Human merge + release gates — never auto-merge.

## When launched as the Coding cloud agent

Follow `.cursor/skills/ship-grok-release-intel/SKILL.md` and `.cursor/rules/releasedesk-grok-api.mdc`.
Prefer extending the Grok intel path over a new stack.

### App key

`XAI_API_KEY` authenticates the shipped Grok call. Set it in `apps/releasedesk/.env.local` or as a Cursor cloud agent secret. Never commit the value. Template: `.env.example`.

`RELEASEDESK_GROK_API_KEY_*` and `RELEASEDESK_CURSOR_API_KEY_*` are retired and ignored. `GROK_API_KEY` is not a fallback. Absent `XAI_API_KEY` → MOCK labeled.

## Verify

```bash
npm run test:desk
npm run test:core
```
