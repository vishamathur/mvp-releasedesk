# SpaceXAI rebuild — change list

## Enterprise problem chosen

Northwind Bank KYC **release readiness** (brief Space 1): DMs cannot tell if a change is safe to ship.

## Built (this branch)

| Layer | What |
| --- | --- |
| Grok Bots | `grok-bots/bots/{lead,change-analyst,standards,security,builder}` — persona, skills, routines |
| Desk host | `grok-bots-host.ts`, `GET /api/bots`, `POST /api/bots/trigger`, `GrokBotsPanel`, `ChallengeTrigger` |
| Cursor guidance | `AGENTS.md`, `.cursor/rules/releasedesk-grok-api.mdc`, `.cursor/skills/ship-grok-release-intel/SKILL.md` |
| Grok API | `grok-release-intel.ts` + route + panel + tests — classify/extract/score/summarize + trustCheck |
| UI spine | Desk optimized for agent navigation; run page keeps gate + intel + handoffs |

## Preserved

- PR #14 iteration proceed gate (`evaluateIterationProceedGate`, `IterationApprovalGate`)
- Human merge/release gates; feature sign-off; ATLAS/OWASP merge block spine
- Specialist orchestration / scenarios under Lead

## Dropped / demoted (not deleted)

- Intake / demo gallery off Desk hero (still in repo)
- Architecture-first 20-min recording script → superseded by Wednesday runbook (agent-nav first)

## Still open

- Live import into x.ai/bot UI (packs are repo-ready; Desk mirrors open/navigate)
- Live `XAI_API_KEY` for non-MOCK Grok calls in the room
- Optional slide 3 (trade-offs / next) — only if asked

## Why choices (talk track)

- **Why each bot** — clear job boundaries; Security mandatory every change; Builder alone launches Cursor
- **Why Cursor** — ships real Desk code under our rules/skills
- **Why this Grok API** — structured release intel the Lead can act on; not voice/image theater
- **Trust** — schema validation, MOCK labeling, human gates, red_team|security iteration gate
