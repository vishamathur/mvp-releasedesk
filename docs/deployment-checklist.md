# Cursor-maximized deployment checklist

Last updated: 2026-11-17

Operator checklist to run **mvp-releasedesk** with maximum Cursor coverage and minimum self-managed infra. Full project-store copy (with research cross-links): Project `docs/cursor-maximized-deployment-checklist.md`.

**Target:** Desk + KYC on **Cursor Apps**; Lead / specialists / AI Red Teaming / Coding·Testing·Review as **ephemeral Cloud Agents** (**MOCK** default); human merge/release never auto.

---

## Preconditions

- [ ] Cursor plan with **Cloud Agents** (required for Apps + live Cloud Agents API)
- [ ] Repo checkout for Cloud Agents
- [ ] Node 20+ for local/CI smoke
- [ ] MOCK path needs **no** external API keys; real path is opt-in

---

## Environment variables & API keys

### Defaults (CI / demo) — leave unset

| Variable | Default | Purpose |
| --- | --- | --- |
| `RELEASEDESK_CLOUD_CLIENT` | unset / `mock` | Cloud Agents client |
| `RELEASEDESK_AI_RED_TEAM_PROVIDER` | unset / `custom` | AI Red Teaming backend |
| `CURSOR_API_KEY` / `CURSOR_SERVICE_ACCOUNT_KEY` | unset | Live Cloud Agents |
| `GH_TOKEN` / `GITHUB_TOKEN` | unset | Real GitHub PR client |
| `XAI_API_KEY` / `GROK_API_KEY` | unset | Optional Grok enrichment |
| `ZSCALER_AI_RED_TEAM_API_KEY` / `ZSCALER_AIRT_API_KEY` / `AIGUARD_API_KEY` | unset | Zscaler stub only |

### Opt-in real

| Variable | Effect |
| --- | --- |
| `CURSOR_API_KEY` **or** `CURSOR_SERVICE_ACCOUNT_KEY` + `RELEASEDESK_CLOUD_CLIENT=real` | Live Cloud Agents |
| `GH_TOKEN` **or** `GITHUB_TOKEN` | Real GitHub PR open/track/poll (**merge still refused**) |
| `XAI_API_KEY` **or** `GROK_API_KEY` | Optional Grok; else local/`MOCK` |
| `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` | Zscaler **stub** (see below) |

**Secrets:** never commit `.env`; bind via Cursor Apps / dashboard; do not paste keys into chat.

---

## MOCK vs real Cloud Agents

| Mode | Env | Creds | Use |
| --- | --- | --- | --- |
| **MOCK** (default) | unset or `=mock` | None | CI, demos, local MVP |
| **real** | `RELEASEDESK_CLOUD_CLIENT=real` | `CURSOR_API_KEY` or `CURSOR_SERVICE_ACCOUNT_KEY` | Live agents |

```bash
# MOCK
unset RELEASEDESK_CLOUD_CLIENT CURSOR_API_KEY

# Real
export CURSOR_API_KEY=...
export RELEASEDESK_CLOUD_CLIENT=real
```

- [ ] CI uses MOCK
- [ ] Agents never auto-merge (Lead human gates)
- [ ] Durable run store available when multi-VM Cloud Agents share state

---

## Cursor Apps — KYC + Release Desk

Requires a **Cloud Agent** (not local) + paid Cloud Agents plan. See also [`cursor-sdlc-guidance.md`](./cursor-sdlc-guidance.md).

| App | Path | Notes |
| --- | --- | --- |
| Northwind KYC | `apps/kyc` | Demo/internal; `npm run seed && npm run dev` |
| Release Desk | `apps/releasedesk` | Ops UI; `npm run desk` |

Per app:

- [ ] Cloud Agent checkout + `npm install` / builds
- [ ] Preview URL healthy
- [ ] No secrets in tree; publish via Cursor Apps (`publish-app`, `project_dir` = app folder)
- [ ] Visibility: private or team for internal ops
- [ ] Optional Apps Postgres for durable Desk context
- [ ] Desk → Lead **on-demand only** after dual human approval

Suitable for demos/internal; not a documented SLA host for bank-scale customer KYC.

---

## Zscaler flag (optional — not required for MVP)

See [`zscaler-ai-red-teaming-provider.md`](./zscaler-ai-red-teaming-provider.md).

| Setting | Behavior |
| --- | --- |
| unset / `=custom` | Default MVP provider |
| `=zscaler` without keys | **MOCK** ATLAS/OWASP findings — CI-safe |
| `=zscaler` with Zscaler/`AIGUARD` keys | **not_wired** — never calls live Zscaler APIs today |

- [ ] MVP leaves provider at `custom`
- [ ] Stub demo: `=zscaler` + no credentials → MOCK findings
- [ ] SPLX remains out of band

---

## GitHub PR workflow

| Mode | Env |
| --- | --- |
| MOCK | no token |
| real | `GH_TOKEN` or `GITHUB_TOKEN` |

`mergePullRequest` always throws. Use Desk human merge/release gates + branch protection.

---

## Optional self-hosted workers

Only if execution must stay in-network. Cursor still owns inference/orchestration. **Not required** for the maximize-Cursor MVP path.

---

## Smoke tests

```bash
npm install
npm run seed && npm run dev
npm run build:core && npm run build:lead && npm run build:specialists
npm run desk
npm test
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

Expect without keys: `needs_human`, MOCK labels, pending merge/release, `autoMerge: false`.

**Invariants:** dual approvals before Lead · Security every change · Testing ≠ Verification · feature checklist + merge + release human-only · Zscaler not required.
