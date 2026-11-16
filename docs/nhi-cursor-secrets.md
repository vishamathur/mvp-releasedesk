# Per-agent NHI secrets (Cursor dashboard — no external vault)

Last updated: 2026-11-17 (Asia/Calcutta)

Release Desk attributes Cloud Agent usage to distinct **non-human identities (NHI)** via **named Cursor secrets**. Values live in the **Cursor Dashboard** (Cloud Agent environment secrets and/or Apps dashboard secrets) — **not** in an external vault product and **never** in committed files.

## Where secrets live

| Surface | Use for | Notes |
| --- | --- | --- |
| **Cloud Agent environment secrets** (Dashboard → Environments) | Lead, specialists, Coding/Testing/Review when they run as Cloud Agents | Prefer **Runtime Secrets** (redacted from agent transcripts) |
| **Cursor Apps dashboard secrets** (team + personal) | Desk UI / KYC hosted app if it must dispatch Cloud Agents server-side | Injected into the hosted app; building agents never see values |
| **Repo `.env` / committed files** | **Forbidden for real values** | Document **names only** here; publish blocks secrets in files |

There is **no** separate “Cursor Key Vault” product and **no** MVP requirement to wire HashiCorp Vault / AWS Secrets Manager. Prefer **OIDC** short-lived credentials where Cursor supports them for cloud roles; long-lived API keys are the fallback for `api.cursor.com`.

## Secret names (placeholders)

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
| Zscaler stub (optional) | `RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY` (or existing `ZSCALER_*` / `AIGUARD_API_KEY` aliases) |

Legacy shared fallback (local/dev only; **discouraged for NHI**): `CURSOR_API_KEY` / `CURSOR_SERVICE_ACCOUNT_KEY`.

## Runtime resolution (operator view)

1. **MOCK default** — CI/demo needs **no** secrets (`RELEASEDESK_CLOUD_CLIENT` unset / `mock`).
2. **Real mode** — `RELEASEDESK_CLOUD_CLIENT=real`; each Cloud Agent dispatch should use the matching `RELEASEDESK_CURSOR_API_KEY_*` injected by Cursor named secrets.
3. If a per-agent slot is empty, fall back to the legacy shared key only for local/dev and never log the value.

Per-agent key resolution lands with the Lead/specialists → Cloud Agents conversion; until then, document these **names** in the Dashboard so environments are ready.

## Operator checklist

1. Leave CI on MOCK (no secrets).
2. Cursor Dashboard → Cloud Agent **Environment** secrets → add each `RELEASEDESK_CURSOR_API_KEY_*` as a **Runtime Secret** (and Zscaler placeholder if used).
3. If Desk App calls the Cloud Agents API server-side, mirror the same **names** under Apps dashboard team/personal secrets.
4. Set `RELEASEDESK_CLOUD_CLIENT=real` only where those secrets exist.
5. Do not paste real keys into chat, PRs, or committed `.env` files.

See also: [`deployment-checklist.md`](./deployment-checklist.md), [`cursor-maximized-architecture.md`](./cursor-maximized-architecture.md), [`cursor-sdlc-guidance.md`](./cursor-sdlc-guidance.md).
