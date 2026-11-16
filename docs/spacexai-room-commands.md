# SpaceXAI room commands (SDLC MVP)

Branch: `cursor/sdlc-mvp-its-2ceb`

## Setup Grok Bots (create in app — no public create API)

```bash
npm run setup:grok-bots
```

Paste each `firstMessage` into Grok Bot → New Bot. Set exclusive keys from `.env.example`.

## Desk

```bash
npm run desk
# http://localhost:3001/mvp   — full surface + requirements + open/trigger/gate + ship
# http://localhost:3001/agents
```

## One Cursor→Grok API ship demo

```bash
export RELEASEDESK_GROK_API_KEY_BUILDER=...   # never shared XAI_API_KEY for SDLC
npm run demo:grok-intel
# file: packages/releasedesk-specialists/src/grok-api-intel.ts
```

## Live Cursor Cloud Agents (Coding / Testing / Review)

```bash
export RELEASEDESK_CURSOR_API_KEY_CODING=...
export RELEASEDESK_CURSOR_API_KEY_TESTING=...
export RELEASEDESK_CURSOR_API_KEY_REVIEW=...
export RELEASEDESK_CLOUD_CLIENT=real
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

## Portfolio check (agility / security / token)

```bash
npm run sdlc:mvp
```

## Gates

- Iteration: `red_team | security` via Desk `/mvp` or `POST /api/iteration-gate`
- Merge/release: human only
