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
| `/handoff` | PID-ER and PID-NC trace from the Log directory or an imported `.jsonl` file |

## Demo script

1. Open [http://localhost:3002/handoff](http://localhost:3002/handoff).
2. Set `RELEASEDESK_LOG_DIR`, or import a `.jsonl` file in the browser. There is no Replay.
3. Open a request and read the lanes, gate decisions, and anomalies.
4. Open `/agents` for each bot's persona, skills, and routines.

## Credentials

There is no mock mode. The Desk does not launch Cursor agents or open pull requests. A missing exclusive key throws a configuration error in the client that needs it. Voice is not a channel.

## Layout

```
apps/releasedesk/
  src/app/           # Next.js pages + API routes
  src/components/    # Desk UI
  src/lib/           # Handoff log, bots, release intel
  scripts/           # desk-once.sh, setup-nhi-keys.sh
```

API surface:

- `GET /api/bots` — Grok Bot roster
- `GET /api/grok/release-intel` — key presence only
- `POST /api/grok/release-intel` — stateless classify/summarize (no run id)
- `GET /api/handoff` — list requests from `RELEASEDESK_LOG_DIR`
- `GET /api/handoff/:requestId` — the Log trace for one request

Handover specs are `grok-bots/processes/pid-er.v1.json`, `grok-bots/processes/pid-nc.v1.json`, and `grok-bots/protocols/handoff.v1.json`. The desk reads the log. It does not call Cursor. `apps/intake` is not part of this app.
