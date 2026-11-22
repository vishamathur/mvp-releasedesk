# SpaceXAI Grok Bots — Lead + specialists

Roster (≥3 specialists): **Lead**, **Change Analyst**, **Standards**, **Security**, **Builder**.

Each bot definition aligns to Grok Bot fields: **persona · skills · routines · connectors** (plus teammates/channels).

## Where the bots live

The five bots were created in the **Grok Bot app** on 2026-11-18 as teammates. They are **not** xAI Agents API resources. `POST /v1/bots` is not a public route (404), and `POST /v1/agents` is a different API that this team could not use to create them.

`grok-bots/registry.json` records each teammate:

| Field | Meaning |
| --- | --- |
| `host` | `"grok-bot-app"` |
| `grokBotAppAgentId` | Grok Bot app agent id |
| `grokBotAppName` | Name shown in the Grok Bot app |
| `status` | `"created_in_grok_bot_app"` |
| `liveBotId` | Always `null` here. Reserved for an id returned by the xAI Agents API. Never copy an app agent id into this field. |
| `lastError` | `null`. Earlier xAI 403/401/fetch failures are not the current provision state. |

| Bot | App name | Grok Bot app agent id |
| --- | --- | --- |
| Lead | Release Desk Lead | `46e50097-0409-4972-9be0-6ade37563135` |
| Change Analyst | Change Analyst | `d68fd46b-cffd-4f58-883e-1a75657ccb99` |
| Standards | Standards | `a82edff2-7d5d-47f2-b8bf-fb4f503177f1` |
| Security | Security | `c325bdd3-28df-419e-9824-4ede1338afc9` |
| Builder | Builder | `c932bf04-d05e-4809-a5cc-64afa9fb0894` |

Desk (`/agents`, the Grok Bots panel, and `GET /api/bots`) reads this registry and shows the bots as **created**. Nothing in Desk calls `api.x.ai` with these ids. App bots do not take API keys.

## API keys (application code, not the Grok Bot app)

Each bot's application calls use **only** that bot's exclusive env var. Shared `XAI_API_KEY` / `GROK_API_KEY` are never fallbacks. A missing key is a labeled **MOCK** for that bot.

| Bot | Definition | Exclusive key | Reads it from |
| --- | --- | --- | --- |
| Lead | `definitions/lead.json` | `RELEASEDESK_GROK_API_KEY_LEAD` | Desk `grok-release-intel.ts` (`resolveAgentGrokApiKey("lead")`) |
| Change Analyst | `definitions/change-analyst.json` | `RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST` | `packages/releasedesk-specialists` change-analyst runner |
| Standards | `definitions/standards.json` | `RELEASEDESK_GROK_API_KEY_STANDARDS` | standards runner |
| Security | `definitions/security.json` | `RELEASEDESK_GROK_API_KEY_SECURITY` | security runner |
| Builder | `definitions/builder.json` | `RELEASEDESK_GROK_API_KEY_BUILDER` | builder runner and specialist `grok-api-intel.ts` |

Cursor Cloud Agents under Builder use their own keys (no shared `CURSOR_API_KEY`):

| Agent | Env |
| --- | --- |
| Coding | `RELEASEDESK_CURSOR_API_KEY_CODING` |
| Testing | `RELEASEDESK_CURSOR_API_KEY_TESTING` |
| Review | `RELEASEDESK_CURSOR_API_KEY_REVIEW` |

Live Coding dispatch also needs `RELEASEDESK_CLOUD_CLIENT=real`.

### Where to set the keys

Never commit real secrets.

- **Local Desk** (`npm run desk`, Next.js on `:3002`): `apps/releasedesk/.env.local`. Next does not load a repo-root `.env`. Start from the repo-root template: `cp .env.example apps/releasedesk/.env.local`, or run `bash apps/releasedesk/scripts/setup-nhi-keys.sh`.
- **Cursor Cloud Agent secrets**: set the same `RELEASEDESK_*` names on the cloud agent environment.

Names and empty values are listed in `.env.example`.

## Definitions (source of truth for persona / skills / routines)

Local JSON definitions in `grok-bots/definitions/` and markdown packs in `grok-bots/bots/` describe how Desk opens each bot. The Grok Bot app ids above are the live teammates; the JSON files are not a second set of API agents.

## Desk

`npm run desk` → Grok Bots panel opens persona / skills / routines / connectors from these definitions and shows each bot as created in the Grok Bot app. Iteration gate (`red_team` \| `security`) from PR #14 is preserved.
