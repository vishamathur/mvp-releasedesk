# mvp-releasedesk

**Release Desk** will orchestrate release checks for the **Northwind Bank KYC** application.

This repository currently includes:

- **Milestone 1** — working KYC demo app (`apps/kyc`)
- **Milestone 2** — shared execution context + agent contracts (`packages/releasedesk-core`)
- **Milestone 3** — Lead Agent orchestrator (`packages/releasedesk-lead`)
- **Milestone 4** — specialist agents (`packages/releasedesk-specialists`)
- **Milestone 5** — Builder → Cursor Cloud Agents (Coding / Testing / Review; MOCK by default)

License: [GPL-3.0](./LICENSE).

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Command | Description |
| --- | --- |
| `npm run dev` | Start the KYC app (Next.js) on port 3000 |
| `npm run seed` | Load sample applications into the local JSON store |
| `npm test` | Run KYC + core + lead + specialists unit tests |
| `npm run test:kyc` / `npm run test:core` / `npm run test:lead` / `npm run test:specialists` | Workspace-scoped tests |
| `npm run build` / `npm start` | Production build and serve KYC |
| `npm run build:core` / `npm run build:lead` / `npm run build:specialists` | Compile packages to `dist/` |
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
  kyc/                      # Northwind Bank KYC (Milestone 1)
packages/
  releasedesk-core/           # Shared run context + agent contracts (Milestone 2)
  releasedesk-lead/           # Lead Agent orchestrator (Milestone 3)
  releasedesk-specialists/    # Specialists + Builder Cloud Agents (M4–M5)
# later (not in this PR):
#   Verification / PR workflow (M6)
#   releasedesk/            # Orchestration / UI (M7)
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

## KYC domain snapshot

- Statuses: `draft` → `submitted` → `in_review` → `approved` | `rejected` | `needs_info`
- Required docs to submit: one government ID (`passport` \| `national_id` \| `drivers_license`) + `proof_of_address`
- Persistence: `apps/kyc/data/store.json` (gitignored; recreated by seed)

## Later milestones (out of scope here)

- Verification loops / PR workflow (M6)
- Release Desk UI and demo scenarios (M7)

## GPL-3.0

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
