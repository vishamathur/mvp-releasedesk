# Per-agent NHI secrets (Cursor named secrets — no external vault)

Last updated: 2026-11-17 (Asia/Calcutta)

Release Desk attributes Cloud Agent usage to distinct non-human identities (NHI) via **named environment secrets**. Values live in **Cursor**, not in an external vault product and never in committed files.

## Where secrets live

| Surface | Use for | Notes |
| --- | --- | --- |
| **Cloud Agent environment secrets** (Dashboard / Environments API) | Lead, specialists, Coding/Testing/Review when they run as Cloud Agents | Prefer **Runtime Secrets** (redacted from agent transcripts). Types also include Environment Variable and Build Secret. |
| **Cursor Apps dashboard secrets** (team + personal) | Desk UI / KYC hosted app if it must dispatch Cloud Agents | Values are injected into the hosted app; the building agent never sees secret values. |
| **Repo `.env` / committed files** | **Forbidden for real values** | `.env.example` lists **names only**. Publish blocks secrets in files. |

There is **no** separate “Cursor Key Vault” product and **no** Release Desk requirement to wire HashiCorp Vault / AWS Secrets Manager for MVP. Enterprise teams may still federate via **Cursor OIDC** to an external vault later; that remains optional and out of band.

## Prefer OIDC over long-lived keys

Where Cursor guidance allows (Cloud Agent cloud-role access, Environments), prefer **OIDC short-lived JWTs** over long-lived API keys. Long-lived `RELEASEDESK_CURSOR_API_KEY_*` values are the fallback when a Cursor API key is required for `api.cursor.com` Cloud Agents API calls.

## Required secret **names** (placeholders)

Configure these as **named secrets** in the Cloud Agent environment and/or Apps dashboard (same names the runtime reads via `process.env`):

| Agent / provider | Secret name |
| --- | --- |
| Lead | `RELEASEDESK_CURSOR_API_KEY_LEAD` |
| Change Analyst | `RELEASEDESK_CURSOR_API_KEY_CHANGE_ANALYST` |
| Standards | `RELEASEDESK_CURSOR_API_KEY_STANDARDS` |
| Security | `RELEASEDESK_CURSOR_API_KEY_SECURITY` |
| Builder | `RELEASEDESK_CURSOR_API_KEY_BUILDER` |
| AI Red Teaming | `RELEASEDESK_CURSOR_API_KEY_AI_RED_TEAMING` |
| Coding | `RELEASEDESK_CURSOR_API_KEY_CODING` |
| Testing | `RELEASEDESK_CURSOR_API_KEY_TESTING` |
| Review | `RELEASEDESK_CURSOR_API_KEY_REVIEW` |
| Zscaler stub | `RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY` |

Legacy shared fallback (local/dev only, discouraged for NHI): `CURSOR_API_KEY` / `CURSOR_SERVICE_ACCOUNT_KEY`.

## Runtime resolution

Package `@releasedesk/specialists` (`cloud/agent-keys.ts` / `resolveCloudAgentClient` — shipped with Lead/specialists Cloud Agents conversion):

1. MOCK default — no secrets required (`RELEASEDESK_CLOUD_CLIENT` unset/`mock`).
2. Real mode — each dispatch picks the key for `agentKind` from the matching `RELEASEDESK_CURSOR_API_KEY_*` env (injected by Cursor named secrets).
3. If the per-agent slot is empty, fall back to legacy shared key and record `usedLegacySharedFallback` in provider metadata (never log the secret value).

## Operator checklist

1. Leave CI on MOCK (no secrets).
2. In Cursor Dashboard → Cloud Agent **Environment** secrets, add each `RELEASEDESK_CURSOR_API_KEY_*` as a **Runtime Secret** (and Zscaler placeholder if used).
3. If Desk App must call the Cloud Agents API server-side, mirror the same **names** under Apps dashboard team/personal secrets.
4. Set `RELEASEDESK_CLOUD_CLIENT=real` only in environments that have those secrets.
5. Do not paste real keys into chat, PRs, or `.env` files that might be published.

See also: [`deployment-checklist.md`](./deployment-checklist.md), [`cursor-maximized-architecture.md`](./cursor-maximized-architecture.md), [`cursor-sdlc-guidance.md`](./cursor-sdlc-guidance.md), [`.env.example`](../.env.example).
