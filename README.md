# mvp-releasedesk

**Release Desk** orchestrates the full SDLC for the **Northwind Bank KYC** application: multi-customer intake → Lead specialists → AI Red Teaming → ATLAS/OWASP hard block → Cloud Coding / **Testing** / Review (MOCK by default) → independent **Verification** → checkpoints + remediate → feature checklist → human merge/release.

Architecture diagram: [`docs/architecture-mermaid.md`](./docs/architecture-mermaid.md).  
Cursor SDLC operator notes (Testing vs Verification): [`docs/cursor-sdlc-guidance.md`](./docs/cursor-sdlc-guidance.md).  
Optional Zscaler provider (flag off / MOCK): [`docs/zscaler-ai-red-teaming-provider.md`](./docs/zscaler-ai-red-teaming-provider.md).  
Agent token optimization (six areas + estimates): [`docs/token-optimization-plan.md`](./docs/token-optimization-plan.md).

License: [GPL-3.0](./LICENSE).

## How to run the MVP (no Zscaler / Cloud credentials required)

Requires Node.js 20+. Everything below uses **MOCK** specialists, Cloud Agents, GitHub PR client, and AI Red Teaming (`custom` provider) by default.

```bash
npm install

# 1) Northwind KYC app (port 3000)
npm run seed
npm run dev
# → http://localhost:3000

# 2) Release Desk UI (port 3001) — full Lead orchestration demos
npm run build:core && npm run build:lead && npm run build:specialists
npm run generate:demos
npm run desk
# → http://localhost:3001

# 3) On-demand release check (CLI, MOCK stubs)
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --json

# 4) Unit tests across the monorepo
npm test
```

Optional (not required for MVP):

| Env | Effect |
| --- | --- |
| `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` | Optional Zscaler stub; **MOCK** without credentials |
| `CURSOR_API_KEY` + `RELEASEDESK_CLOUD_CLIENT=real` | Real Cursor Cloud Agents |
| `GH_TOKEN` / `GITHUB_TOKEN` | Real GitHub PR client |

## Quick start (short)

```bash
npm install
npm run seed
npm run dev          # KYC → :3000
npm run desk         # after build:core/lead (+ generate:demos) → :3001
```

| Command | Description |
| --- | --- |
| `npm run dev` | Start the KYC app (Next.js) on port 3000 |
| `npm run desk` | Start Release Desk UI on port **3001** |
| `npm run seed` | Load sample applications into the local JSON store |
| `npm test` | Run KYC + core + lead + specialists + desk unit tests |
| `npm run test:kyc` / `npm run test:core` / `npm run test:lead` / `npm run test:specialists` / `npm run test:desk` | Workspace-scoped tests |
| `npm run build` / `npm start` | Production build and serve KYC |
| `npm run build:desk` / `npm run start:desk` | Production build and serve Release Desk UI |
| `npm run build:core` / `npm run build:lead` / `npm run build:specialists` | Compile packages to `dist/` |
| `npm run generate:demos` | Record demo run-context fixtures via Lead orchestrator |
| `npm run check:release -- --repo owner/name` | On-demand Lead + specialists release check (CLI) |
| `npm run check:release:stubs -- --repo owner/name` | Same flow with M3 MOCK stub runners |

## What you can do

1. Open the landing page and start **Customer KYC**.
2. Enter identity details → create a draft.
3. Add **document placeholders** (filename + type; no real file upload).
4. Submit → local risk score + status `submitted`.
5. Use analyst actions: start review → approve / needs info / reject.
6. Or **Load sample data** on `/applications` for pre-built cases.

## Mocked integrations (labeled in UI/API)

| Integration | Behavior in this milestone |
| --- | --- |
| Document upload / storage | Metadata only (`fileName`, `mockStorageKey`). No file bytes persisted. |
| Document OCR | Fabricated `mockOcrSummary` string. No OCR vendor API. |
| Identity verification / liveness | Selfie is a placeholder document type only. |
| Sanctions / PEP / bureau screening | Local deterministic risk rules in `apps/kyc/src/lib/domain/risk.ts`. Notes include a `MOCK:` prefix. |

## Monorepo layout

```
apps/
  kyc/                        # Northwind Bank KYC (Milestone 1)
  releasedesk/                # Release Desk UI + demos (Milestone 7)
packages/
  releasedesk-core/           # Shared run context + agent contracts (Milestone 2)
  releasedesk-lead/           # Lead orchestrator + verification/PR workflow (M3 + M6)
  releasedesk-specialists/    # Specialists + Builder Cloud Agents (M4–M5)
```

Root `package.json` uses npm workspaces (`apps/*`, `packages/*`). Keep agent/runtime packages out of `apps/kyc` so release-check tooling can land beside the demo app without a rewrite.

## Milestone 2 — shared context & contracts

Package: [`packages/releasedesk-core`](./packages/releasedesk-core/) (`@releasedesk/core`).

- Unique `run_` IDs and a parallel-safe task model (status, dependencies, evidence, retry/failure)
- Zod schemas for Lead, Change Analyst, Standards, Security, and Builder agent I/O
- Audit trail hooks on every store mutation
- In-memory and file-backed run-context stores
- Clear `MOCK:` / `mocked: true` labeling for stubbed integrations

```bash
npm run test:core
```

See the [package README](./packages/releasedesk-core/README.md) for how agents plug in.

## Milestone 3 — Lead Agent orchestrator

Package: [`packages/releasedesk-lead`](./packages/releasedesk-lead/) (`@releasedesk/lead`).

- Creates unique runs via `@releasedesk/core` and delegates to pluggable specialist `AgentRunner`s
- Default specialists are **MOCK stubs** that still write real task records, evidence, and audit events
- Parallel analysis wave; retry/failure handling; remediation + reverification loop structure
- Human approval gates for merge/release (**not** auto-approved)
- CLI: `npm run check:release -- --repo vishamathur/mvp-releasedesk`

```bash
npm run test:lead
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

## Milestone 4 — specialist agents

Package: [`packages/releasedesk-specialists`](./packages/releasedesk-specialists/) (`@releasedesk/specialists`).

- Real `AgentRunner` implementations for Change Analyst, Standards, Security, Builder, and **AI Red Teaming**
- Injected into Lead via `createSpecialistRunners()` — results written independently onto shared run context
- Local git / Northwind policy fixtures / sample CVE JSON when live APIs unavailable (`MOCK:` labels)
- Builder prepares Cursor Cloud Agent handoffs and (M5) dispatches Coding → Testing ∥ Review
- AI Red Teaming: cross-cutting ATLAS/OWASP guardrails + realtime Lead flags; reuses shared `AiRedTeamingProvider` from core (`custom` | `zscaler`)

```bash
npm run test:specialists
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

## Milestone 5 — Cursor Cloud Agents under Builder

Builder dispatches **Coding**, then **Testing** and **Review** in parallel, recording branch names, test results, and PR URLs on the shared run context. Default client is clearly labeled **MOCK:** so CI does not need Cursor credentials. Enable the real client with:

```bash
export CURSOR_API_KEY=...                 # or CURSOR_SERVICE_ACCOUNT_KEY
export RELEASEDESK_CLOUD_CLIENT=real
```

Cloud Agents never auto-merge — Lead human merge/release gates stay pending. See [`packages/releasedesk-specialists/README.md`](./packages/releasedesk-specialists/README.md).

## Milestone 6 — verification loops + PR workflow

Lead runs **checkpoint verification** after specialist analysis and after Builder/Cloud Agent stages, drives remediation → reverify when checkpoints fail, and tracks PRs via a pluggable GitHub client (**MOCK:** by default; real when `GH_TOKEN` / `GITHUB_TOKEN` is set). Merge and release still require **explicit human approval** — never auto-merge.

```bash
npm run test:lead
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --approve --json
```

See [`packages/releasedesk-lead/README.md`](./packages/releasedesk-lead/README.md).

## Milestone 7 — Release Desk UI + demo scenarios

App: [`apps/releasedesk`](./apps/releasedesk/) (`@releasedesk/ui`).

- Delivery-manager surface for consolidated release readiness from Lead runs
- Start on-demand checks; inspect specialists, checkpoints, cloud handoffs, PRs, audit trail
- Human approve/reject for merge + release (never auto-merges)
- Demo scenarios: happy path, remediation loop, blocked-on-security, pending approval
- UI driven by real orchestrator outputs / recorded `fixtures/demos/*.json` — not fake agent chat
- MOCK integrations clearly labeled (stubs, GitHub PR client, voice)

```bash
npm run desk
# Demo script: apps/releasedesk/README.md
```

## KYC domain snapshot

- Statuses: `draft` → `submitted` → `in_review` → `approved` | `rejected` | `needs_info`
- Required docs to submit: one government ID (`passport` \| `national_id` \| `drivers_license`) + `proof_of_address`
- Persistence: `apps/kyc/data/store.json` (gitignored; recreated by seed)

## GPL-3.0

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
