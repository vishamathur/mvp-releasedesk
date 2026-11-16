# Wednesday 9am — 30-minute morning runbook

**Goal:** Minimal prep. Agent navigation first. Then gate. Then Grok API.

## Optimized file list (open these tabs)

| Priority | Path | Why |
| --- | --- | --- |
| 1 | Desk `/desk` | `GrokBotsPanel` — look / pull up / move agent→agent / Security deep dive |
| 2 | `grok-bots/bots/*/PERSONA.md` | Live “open your bots” if asked to edit |
| 3 | Run page after trigger | Iteration gate + Grok intel + handoffs |
| 4 | `packages/releasedesk-core/src/ai-red-teaming/checkpoint-gate.ts` | Gate proof in repo |
| 5 | `apps/releasedesk/src/lib/grok-release-intel.ts` | Grok API ship path |
| 6 | Slides: [spacexai-slide-1-problem.md](./spacexai-slide-1-problem.md), [spacexai-slide-2-architecture.md](./spacexai-slide-2-architecture.md) | ≤3 min framing |

## T-30 → T-0

1. `npm install` if needed; `npm run build:core && npm run build:lead`
2. Start Desk: `npm run dev:desk` (or monorepo script) → `:3001`
3. Optional live keys (else MOCK labeled — say why):
   - `export RELEASEDESK_GROK_API_KEY_LEAD=...` for live Desk Grok intel
   - `export RELEASEDESK_CURSOR_API_KEY_CODING=...` (+ TESTING/REVIEW) and `RELEASEDESK_CLOUD_CLIENT=real` for live Cursor agents
4. Open `/desk`, click through Lead → CA → Standards → **Security** (deep dive) → Builder
5. Dry-run Challenge Trigger once; confirm run page shows gate + Grok panel
6. Put two slides fullscreen; kill Slack/email

## Live session beat (most time in system)

| Min | Beat |
| --- | --- |
| 0–3 | Slide 1 → Slide 2 |
| 3–12 | **Agent navigation spine** — pull bots, move agent→agent, deep-dive Security persona/skills/routines |
| 12–18 | Trigger workflow → walk handoffs on run |
| 18–25 | **Gate proof** — approve as red_team; show open; reject path if time |
| 25–35 | **Grok API depth** — run intel; point at trustCheck + MOCK if no key |
| 35–45 | Live change request + Q&A |

## Ranked risks (what looks fake / can fail)

1. **No x.ai/bot live UI** — Desk pack browser is real; say packs paste into Grok Bot; don’t claim native x.ai UI if not logged in.
2. **MOCK Grok without key** — fine if labeled; looks fake if you say “live API” without `RELEASEDESK_GROK_API_KEY_LEAD`.
3. **Cloud Agents MOCK by default** — need exclusive `RELEASEDESK_CURSOR_API_KEY_CODING` (+ TESTING/REVIEW) and `RELEASEDESK_CLOUD_CLIENT=real` for live; name MOCK otherwise.
4. **Architecture slide out of date** — old Mermaid still says “Cloud Agents MOCK”; use `spacexai-slide-2-architecture.md`.
5. **Intake demoted** — don’t start on intake; stay on agent nav → trigger → gate → intel.

## If something breaks

- No API key → MOCK is intentional; trust story still holds
- Gate missing on run → open iteration-gate demo scenario from Desk history
- Bot pack edit live → edit `PERSONA.md` or skill markdown; refresh Desk bots API
