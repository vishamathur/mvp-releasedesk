# Release Desk UI

Bots run the process; Release Desk Log records it; Desk shows it.

## Run locally

From the monorepo root (Node 20+):

```bash
npm install
npm run build:core && npm run build:lead
npm run desk                                # http://localhost:3002
```

| Command | Description |
| --- | --- |
| `npm run desk` | Start Release Desk UI on port **3002** |
| `npm run build:desk` / `npm run start:desk` | Production build + serve UI |
| `npm run test:desk` | Desk unit tests |

KYC demo remains on port 3000 (`npm run dev`).

## SpaceXAI control plane

| Route | Purpose |
| --- | --- |
| `/agents` | Grok Bot roster from `GET /api/bots` |
| `/desk` | Bot navigation and the handover trace |
| `/handoff` | PID-ER and PID-NC trace (Log directory or Replay MOCK) |

## Demo script

1. Open [http://localhost:3002/handoff](http://localhost:3002/handoff).
2. Turn on Replay (MOCK), or set `RELEASEDESK_LOG_DIR`, or import a `.jsonl` file in the browser.
3. Open a request and read the lanes, gate decisions, and anomalies.
4. Open `/agents` for each bot's persona, skills, and routines.

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

- `GET /api/bots` — Grok Bot roster
- `GET /api/grok/release-intel` — key presence only
- `POST /api/grok/release-intel` — stateless classify/summarize (no run id)
- `GET /api/handoff` — list requests from `RELEASEDESK_LOG_DIR`, or Replay (MOCK) fixtures
- `GET /api/handoff/:requestId` — the Log trace for one request

Handover specs are `grok-bots/processes/pid-er.v1.json`, `grok-bots/processes/pid-nc.v1.json`, and `grok-bots/protocols/handoff.v1.json`. The desk runs them with mock teammates. It does not set `RELEASEDESK_CLOUD_CLIENT=real` and it does not call Cursor. `apps/intake` is not part of this app.
