# Release Desk UI (Milestone 7)

Always-on delivery-manager surface for **Northwind Bank KYC** release readiness. Desk triggers an ephemeral **Lead Cloud Agent** **on demand only** (no backlog queue scheduler) — dual intake approvals, specialist Cloud Agents (MOCK by default), checkpoints, cloud-agent handoffs, PR metadata, audit trail, **feature sign-off checklists** (AI-produced code), and human merge/release gates.

Voice is optional and **MOCK**-labeled only. Prefer Cursor Apps hosting for Desk; Lead/specialists run as ephemeral Cloud Agents.

## Run locally

From the monorepo root (Node 20+):

```bash
npm install
npm run build:core && npm run build:lead
npm run generate:demos -w @releasedesk/ui   # recorded run-context fixtures
npm run desk                                # http://localhost:3001
```

| Command | Description |
| --- | --- |
| `npm run desk` | Start Release Desk UI on port **3001** |
| `npm run build:desk` / `npm run start:desk` | Production build + serve UI |
| `npm run test:desk` | UI + scenario unit tests |
| `npm run generate:demos -w @releasedesk/ui` | Re-record demo fixtures via live orchestrator |

KYC demo remains on port 3000 (`npm run dev`).

## Demo script

1. Open [http://localhost:3001](http://localhost:3001) — hero brands **Release Desk** / Northwind Bank.
2. Click **Enter the desk**.
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
   - Use **Start release check** → Desk calls `startLeadCloudAgent` (MOCK Lead + specialist Cloud Agents, shared file store, MOCK GitHub). No scheduler.
8. **MOCK voice**
   - In Lead interface, send **MOCK voice** — reply is labeled `MOCK:`; no fabricated agent transcripts.
9. **Fixtures**
   - **Load fixture** uses `fixtures/demos/*.json` recorded from real orchestrator runs (regenerate with `generate:demos`).

## MOCK integrations (labeled in UI)

| Integration | Behavior |
| --- | --- |
| Lead + specialist Cloud Agents | MOCK `CloudAgentClient` via `startLeadCloudAgent` (CI-safe; no Cursor key) |
| GitHub PR client | MOCK unless `GH_TOKEN` / `GITHUB_TOKEN` is set (UI uses MOCK client) |
| Nested Coding/Testing/Review | Builder remediation path; MOCK by default |
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

- `POST /api/checks` — on-demand Lead check (primary Desk→Lead trigger)
- `GET|POST /api/intake` · `POST /api/intake/approvals` · `POST /api/intake/reorder` · `POST /api/intake/start` — dual approvals + on-demand Lead from `approved_for_dev` (no scheduler)
- `GET /api/runs` · `GET /api/runs/:id`
- `POST /api/runs/:id/approvals` — merge/release gates (never auto-merges)
- `POST /api/runs/:id/feature-signoffs` — per-item or full feature checklist sign-off (never auto-signed)
- `POST /api/demos` — live or fixture scenarios
- `POST /api/dm` — text or MOCK voice
