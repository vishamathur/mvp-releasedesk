# SpaceXAI room runbook — single page

**Branch tip:** `cursor/enterprise-sdlc-showcase-79dc` (stacked on #29 → #28)  
**Slides:** [spacexai-demo-slides.md](./spacexai-demo-slides.md) (≤3 min) → then live system.  
**Also:** `/control` enterprise depth surface + `npm run demo:control-plane` (from #29).

---

## Commands (start here)

```bash
npm install
npm run build:core && npm run build:lead && npm run build:specialists
npm run test:core && npm run test:desk
npm run desk          # http://localhost:3002
# optional CLI portfolio proof:
npm run sdlc:mvp
# preserves Grok Bot app teammates; does not POST api.x.ai:
npm run create:grok-bots -- --dry-run
```

### Live Grok (optional — otherwise honest MOCK)

Set `XAI_API_KEY` in `apps/releasedesk/.env.local`. Do not commit it. Per-bot keys are ignored. Do not set `RELEASEDESK_CLOUD_CLIENT=real`. Builder launches Cursor from the Grok Bot app. Process specs: `docs/sdlc/overview.md`.

---

## What to click (live beat)

| Order | Click | Show |
| --- | --- | --- |
| 1 | `/control` or `/mvp` | Control plane depth · portfolio · keys · intel |
| 2 | **Run portfolio check** | Northwind / Contoso / Fabrikam · mandatory Security · token savings |
| 3 | `/agents` then back | Full roster: Lead · CA · Standards · Security · Builder + Coding/Testing/Review |
| 4 | Open **Security** persona | skills / routines / connectors (live-edit `grok-bots/definitions/security.json` or `bots/security/PERSONA.md`) |
| 5 | **Challenge trigger** or `/desk` → Challenge Trigger | Handoffs: Lead→specialists→Builder→Cursor Coding→Grok API |
| 6 | Run page | Iteration gate · Grok intel panel · merge/release gates · feature sign-off |
| 7 | **Sign security** or **Sign red_team** on `/mvp` | `evaluateIterationProceedGate` opens |
| 8 | **Run release intel** | classify / extract / score / summarize + trustCheck (`humanGateStillRequired`) |

Leave buffer for a live bot persona edit + Q&A.

---

## Honest MOCK vs live matrix

| Capability | Live when | Otherwise |
| --- | --- | --- |
| Desk Grok API intel (`grok-release-intel.ts`) | `XAI_API_KEY` set | **MOCK** labeled; per-bot keys ignored |
| Grok Bot teammates | Already created in the Grok Bot app (`grokBotAppAgentId` in `registry.json`, host `grok-bot-app`). App ids are not xAI API ids | `npm run create:grok-bots` does not call xAI for those rows. `liveBotId` stays null |
| Cursor cloud agent | Builder Grok Bot routine `on-build-stage` | Desk stays MOCK and does not launch |
| Specialist runners (Desk UI path) | Wired real runners | **MOCK** stubs (labeled) |
| GitHub PR client (Desk UI) | `GH_TOKEN` / `GITHUB_TOKEN` | **MOCK** GitHub |
| Iteration gate demo on `/mvp` | Always real gate logic | Approvals are process-local demo store |
| Run-scoped iteration / merge / release gates | Always real gate logic | Human must approve; **never auto-merge** |
| ATLAS / OWASP hard-block | Always on review-ready PRs | Drafts exempt |
| Portfolio `/mvp` check | Always runs Lead stubs | Specialists + PR = MOCK; Security participation still evaluated |

**Talk track:** MOCK is intentional when keys are absent — never claim live API without the exclusive env var for that agent.

---

## Architecture ↔ live map (Slide 2 = 4 wires)

| Wire | Slide box | Live surface |
| --- | --- | --- |
| 1 | Intake · Customer ER · cost · priority | `/control` stage 1 · dual cost+queue · fairness backlog |
| 2 | Grok Bots Lead→CA→Standards→Security→Builder | `/agents` · `/desk` · `grok-bots/definitions/*` |
| 3 | Cursor Coding∥Testing∥Review + Grok API intel | Builder handoff · `grok-release-intel.ts` · exclusive NHI |
| 4 | Humans iteration · merge · release → readiness to Lead | Run gates · `/control` stages 4–6 |

**Full detail (ATLAS, side-queue, tokens, ER):** [`architecture-mermaid.md`](./architecture-mermaid.md) · `/control`

---

## If something breaks

- No Lead key → MOCK intel is correct; trustCheck still shows `humanGateStillRequired`
- Gate missing on a run → use `/mvp` gate demo or iteration-gate Desk scenario
- Live-edit bot → edit definition/PERSONA, refresh `/agents` or `/api/bots`
