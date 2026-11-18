# SpaceXAI Grok Bots — Lead + specialists

Roster (≥3 specialists): **Lead**, **Change Analyst**, **Standards**, **Security**, **Builder**.

Each bot definition aligns to Grok Bot fields: **persona · skills · routines · connectors** (plus teammates/channels).

## Definitions (source of truth)

| Bot | Definition | Exclusive key |
| --- | --- | --- |
| Lead | `definitions/lead.json` | `RELEASEDESK_GROK_API_KEY_LEAD` |
| Change Analyst | `definitions/change-analyst.json` | `RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST` |
| Standards | `definitions/standards.json` | `RELEASEDESK_GROK_API_KEY_STANDARDS` |
| Security | `definitions/security.json` | `RELEASEDESK_GROK_API_KEY_SECURITY` |
| Builder | `definitions/builder.json` | `RELEASEDESK_GROK_API_KEY_BUILDER` |

Shared `XAI_API_KEY` / `GROK_API_KEY` are **never** used as fallbacks.

`registry.json` stores live bot IDs **only** when the create API returns them. Until then every `liveBotId` is `null` (no invented IDs).

## Create bots when keys exist

```bash
# Dry run (no HTTP)
npm run create:grok-bots -- --dry-run

# Live create (per-agent keys required)
export RELEASEDESK_GROK_API_KEY_LEAD=...
export RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST=...
export RELEASEDESK_GROK_API_KEY_STANDARDS=...
export RELEASEDESK_GROK_API_KEY_SECURITY=...
export RELEASEDESK_GROK_API_KEY_BUILDER=...
npm run create:grok-bots
```

Optional: `RELEASEDESK_GROK_BOT_API_BASE` (default `https://api.x.ai/v1`), `RELEASEDESK_GROK_BOT_CREATE_PATH` (default `/agents`).

Note: there is **no** public `POST /v1/bots` on `api.x.ai` (404). Product Grok Bots are created in the Grok Bot app; this script targets the closest management API `POST /v1/agents` with `name` + `instructions`. If the team/key lacks Agents entitlement you get HTTP 403 and `liveBotId` stays `null` — Desk still runs on local packs + exclusive keys.

## Desk

`npm run desk` → Grok Bots panel opens persona / skills / routines / connectors from these definitions. Iteration gate (`red_team` \| `security`) from PR #14 is preserved.
