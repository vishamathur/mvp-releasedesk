# Release Desk UI (Milestone 7)

Delivery-manager surface for **Northwind Bank KYC** release readiness. The UI drives the Lead orchestrator (`@releasedesk/lead`) — specialist results, checkpoints, cloud-agent handoffs, PR metadata, audit trail, **feature sign-off checklists** (AI-produced code), and human merge/release gates.

Voice is optional and **MOCK**-labeled only.

## Run locally

From the monorepo root (Node 20+):

```bash
npm install
npm run build:core && npm run build:lead
npm run generate:demos -w @releasedesk/ui   # recorded run-context fixtures
npm run desk                                # http://localhost:3002
```

| Command | Description |
| --- | --- |
| `npm run desk` | Start Release Desk UI on port **3002** |
| `npm run build:desk` / `npm run start:desk` | Production build + serve UI |
| `npm run test:desk` | UI + scenario unit tests |
| `npm run generate:demos -w @releasedesk/ui` | Re-record demo fixtures via live orchestrator |

KYC demo remains on port 3000 (`npm run dev`).

## SpaceXAI control plane

| Route | Purpose |
| --- | --- |
| `/mvp` | Portfolio agility · mandatory Security · token efficiency · gate · Grok intel |
| `/agents` | Full Grok Bot + Cursor Cloud Agent roster |
| `/desk` | Challenge trigger + bot navigation |
| `/handoff` | PID-ER and PID-NC bot-to-bot handover (mock clients) |

Room runbook (commands + clicks + MOCK vs live): monorepo `docs/spacexai-room-runbook.md`.

```bash
npm run sdlc:mvp   # CLI portfolio check
```

## Demo script

1. Open [http://localhost:3002](http://localhost:3002) — hero brands **Release Desk**.
2. Click **Open control plane** (`/mvp`) or **Challenge desk**.
3. **Happy path**
   - Under Demo scenarios → **Happy path** → **Run live**.
   - Confirm readiness `needs_human`, specialists completed, pending merge + release gates.
   - Approve both gates → readiness becomes `ready`. Auto-merge stays false.
4. **Remediation loop**
   - Run **Remediation loop** live.
   - Confirm first security wave blocked, Builder + Reverify tasks exist, checkpoints include remediation stages, then a **feature sign-off checklist** plus pending merge/release gates.
   - Sign off checklist items (or entire checklist), then approve merge + release → `ready`.
5. **Blocked on security**
   - Run **Blocked on security** → security blockers persist after remediation; reject the release gate → `not_ready`.
6. **Pending approval**
   - Run **Pending approval** (or load fixture) — clean check waiting on DM decisions.
7. **On-demand check**
   - Use **Start release check** to call Lead `startOnDemandCheck` with MOCK specialists + MOCK GitHub.
8. **MOCK voice**
   - In Lead interface, send **MOCK voice** — reply is labeled `MOCK:`; no fabricated agent transcripts.
9. **Fixtures**
   - **Load fixture** uses `fixtures/demos/*.json` recorded from real orchestrator runs (regenerate with `generate:demos`).

## MOCK integrations (labeled in UI)

| Integration | Behavior |
| --- | --- |
| Specialist runners (default UI path) | Lead stub runners (`MOCK:` summaries) unless you wire real specialists via CLI |
| GitHub PR client | MOCK unless `GH_TOKEN` / `GITHUB_TOKEN` is set (UI uses MOCK client) |
| Cursor Cloud Agents | Appear only when Builder remediates; MOCK by default |
| Voice channel | Stub acknowledgment only |

## Layout

```
apps/releasedesk/
  src/app/           # Next.js pages + API routes
  src/components/    # Desk UI
  src/lib/           # Orchestrator wiring + scenarios
  fixtures/demos/    # Recorded run-context JSON
  scripts/           # generate-demos.ts
```

API surface:

- `POST /api/checks` — on-demand Lead check
- `GET /api/runs` · `GET /api/runs/:id`
- `POST /api/runs/:id/approvals` — merge/release gates (never auto-merges)
- `POST /api/runs/:id/feature-signoffs` — per-item or full feature checklist sign-off (never auto-signed)
- `POST /api/demos` — live or fixture scenarios
- `POST /api/dm` — text or MOCK voice
- `GET /api/handoff` · `POST /api/handoff` — open a PID-ER or PID-NC request and run to the next human gate
- `GET /api/handoff/:requestId` — stage, messages, and trace
- `POST /api/handoff/:requestId/decision` — human approve/reject (a bot id is refused)
- `POST /api/handoff/:requestId/message` — validate one teammate message

Handover specs are `grok-bots/processes/pid-er.v1.json`, `grok-bots/processes/pid-nc.v1.json`, and `grok-bots/protocols/handoff.v1.json`. The desk runs them with mock teammates. It does not set `RELEASEDESK_CLOUD_CLIENT=real` and it does not call Cursor. `apps/intake` is not part of this app.
