# Release Desk UI (Milestone 7)

Delivery-manager surface for **Northwind Bank KYC** release readiness. The UI drives the Lead orchestrator (`@releasedesk/lead`) — specialist results, checkpoints, cloud-agent handoffs, PR metadata, audit trail, and human merge/release gates.

Voice is optional and **MOCK**-labeled only.

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
| `npm run sdlc:mvp` | CLI portfolio check (agility · security · token efficiency) |

KYC demo remains on port 3000 (`npm run dev`).

## SDLC MVP (`/mvp`)

Delivery-manager surface for the three ITS requirements on the Northwind KYC / Release Desk workspace:

1. **Agility** — on-demand Lead checks across `DEMO_PORTFOLIO` (customerId-tagged)
2. **Security** — mandatory Security specialist participation on every change
3. **Token efficiency** — security-role context slice vs full-run packing (estimated savings)

```bash
npm run build:core && npm run build:lead
npm run desk          # open http://localhost:3001/mvp
npm run sdlc:mvp      # same portfolio check via tsx CLI
```

API:

- `GET /api/sdlc-mvp` — agent defs + credential present/missing (never secret values)
- `POST /api/sdlc-mvp` — run portfolio check with MOCK specialists + MOCK PR

Header and home link to **SDLC MVP**. Missing per-agent keys keep that agent on MOCK paths; exclusive env vars never fall back to shared `XAI_API_KEY` / `CURSOR_API_KEY`.

## Demo script

1. Open [http://localhost:3001](http://localhost:3001) — hero brands **Release Desk** / Northwind Bank.
2. Click **Enter the desk**.
3. **Happy path**
   - Under Demo scenarios → **Happy path** → **Run live**.
   - Confirm readiness `needs_human`, specialists completed, pending merge + release gates.
   - Approve both gates → readiness becomes `ready`. Auto-merge stays false.
4. **Remediation loop**
   - Run **Remediation loop** live.
   - Confirm first security wave blocked, Builder + Reverify tasks exist, checkpoints include remediation stages, then pending human gates.
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
- `POST /api/demos` — live or fixture scenarios
- `POST /api/dm` — text or MOCK voice
- `GET|POST /api/sdlc-mvp` — SDLC MVP catalog / portfolio check
