# mvp-releasedesk

**Release Desk** is Northwind Bank's release process for the **KYC** demo app. Six Grok Bot teammates run it in chat: Lead, Change Analyst, Standards, Security, and Builder, plus Release Desk Log. Lead is the only writer of `pid.state`. Each human gate is raised by the bot that owns that work. The Desk at `/handoff` is a read-only trace of the Log (`RELEASEDESK_LOG_DIR`), with Replay (MOCK) over fixtures. Builder launches the Cursor cloud agent. The release-intel workflow calls the Grok API and stays MOCK without `RELEASEDESK_GROK_API_KEY_LEAD`. KYC (`apps/kyc`) is the demo customer app.

Read [the SDLC overview](./docs/sdlc/overview.md), [the demo script](./docs/sdlc/demo-script.md), and [the bot pack](./grok-bots/README.md).

This repository currently includes:

- **Milestone 1** — working KYC demo app (`apps/kyc`)
- **Milestone 2** — shared execution context + agent contracts (`packages/releasedesk-core`)
- **Milestone 3** — Lead Agent orchestrator (`packages/releasedesk-lead`)
- **Milestone 4** — specialist agents (`packages/releasedesk-specialists`)
- **Milestone 5** — Builder → Cursor Cloud Agents (Coding / Testing / Review; MOCK by default)
- **Milestone 6** — Verification checkpoints, remediation loops, PR workflow + human gates
- **Milestone 7** — Release Desk UI + demo scenarios (`apps/releasedesk`)

License: [GPL-3.0](./LICENSE).

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for KYC.

**Release Desk UI (M7):**

```bash
npm run build:core && npm run build:lead
npm run generate:demos
npm run desk
```

Open [http://localhost:3002](http://localhost:3002).

| Command | Description |
| --- | --- |
| `npm run dev` | Start the KYC app (Next.js) on port 3000 |
| `npm run desk` | Start Release Desk UI on port **3002** |
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

1. Open Release Desk on port **3002** and read a handover at `/handoff` (set `RELEASEDESK_LOG_DIR`, import a `.jsonl` file, or turn on Replay (MOCK)).
2. Follow one PID-ER request in [the demo script](./docs/sdlc/demo-script.md). Change Analyst raises finance, Security raises the iteration gate, and Builder raises release. Vishal decides in that bot's chat.
3. See the release-intel comment on a pull request. It is MOCK until the `RELEASEDESK_GROK_API_KEY_LEAD` Actions secret is set.
4. Open the KYC demo on port 3000: draft an application, add document placeholders, submit, and use the analyst actions. **Load sample data** on `/applications` for pre-built cases.

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

Legacy in-process engine (MOCK); bots now run the process.

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

- Real `AgentRunner` implementations for Change Analyst, Standards, Security, and Builder
- Injected into Lead via `createSpecialistRunners()` — results written independently onto shared run context
- Local git / Northwind policy fixtures / sample CVE JSON when live APIs unavailable (`MOCK:` labels)
- Builder prepares Cursor Cloud Agent handoffs and (M5) dispatches Coding → Testing ∥ Review

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
