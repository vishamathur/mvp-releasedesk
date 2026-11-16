# Grok Bots (Release Desk)

Machine-readable definitions live in `definitions/*.json` and
`packages/releasedesk-core/src/grok-bots/definitions.ts`.

**Not a duplicate of PR #24 markdown packs.** Grok Bot has no public create API;
this repo provides definitions + webhook/xAI client + setup script.

## Full Grok Bot roster (Desk `/mvp` + `/agents`)

| Bot | Definition | Exclusive key | Notes |
| --- | --- | --- | --- |
| RD Lead | `definitions/lead.json` | `RELEASEDESK_GROK_API_KEY_LEAD` | triad highlight |
| RD Change Analyst | `definitions/change-analyst.json` | `RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST` | first-class |
| RD Standards | `definitions/standards.json` | `RELEASEDESK_GROK_API_KEY_STANDARDS` | first-class |
| RD Security | `definitions/security.json` | `RELEASEDESK_GROK_API_KEY_SECURITY` | triad · mandatory |
| RD Builder | `definitions/builder.json` | `RELEASEDESK_GROK_API_KEY_BUILDER` | triad · → Cursor CAs |

Nested Cursor Cloud Agents (not Grok Bots): **Coding · Testing · Review** via
`RELEASEDESK_CURSOR_API_KEY_CODING|TESTING|REVIEW`.

## Create bots live

```bash
npx tsx scripts/setup-grok-bots.ts
```

1. Open [Grok Bot](https://x.ai/bot) → New Bot for each name.
2. Paste printed `firstMessage`.
3. Ask each Bot to create its webhook routine; copy URL + key into `.env`.
4. Set exclusive `RELEASEDESK_GROK_API_KEY_*` (never shared `XAI_API_KEY` for SDLC).

## Trigger from Desk / CLI

- Desk: `/mvp` → Trigger on triad card
- API: `POST /api/bots/trigger` `{ "botId": "lead" }`
- Webhook 200 = run **started** (check Bot chat for finish)

## Cursor → Grok API ship

Builder hands off to Coding Cloud Agent. Shipped module:

`packages/releasedesk-specialists/src/grok-api-intel.ts`

```bash
export RELEASEDESK_GROK_API_KEY_BUILDER=...
npx tsx scripts/demo-grok-intel.ts
```
