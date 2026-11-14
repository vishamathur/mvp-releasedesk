# mvp-releasedesk

**Release Desk** will orchestrate release checks for the **Northwind Bank KYC** application.

This repository currently includes:

- **Milestone 1** — working KYC demo app (`apps/kyc`)
- **Milestone 2** — shared execution context + agent contracts (`packages/releasedesk-core`)
- **Milestone 3** — Lead Agent orchestrator (`packages/releasedesk-lead`)

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
| `npm test` | Run KYC + core + lead unit tests |
| `npm run test:kyc` / `npm run test:core` / `npm run test:lead` | Workspace-scoped tests |
| `npm run build` / `npm start` | Production build and serve KYC |
| `npm run build:core` / `npm run build:lead` | Compile core / lead packages to `dist/` |
| `npm run check:release -- --repo owner/name` | On-demand Lead release check (CLI) |

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
  releasedesk-core/         # Shared run context + agent contracts (Milestone 2)
  releasedesk-lead/         # Lead Agent orchestrator (Milestone 3)
# later (not in this PR):
#   specialist runners      # Change Analyst / Standards / Security / Builder (M4)
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

No full specialist implementations (M4), Cursor Cloud wiring (M5), PR automation (M6), or Release Desk UI (M7) in this milestone.

## KYC domain snapshot

- Statuses: `draft` → `submitted` → `in_review` → `approved` | `rejected` | `needs_info`
- Required docs to submit: one government ID (`passport` \| `national_id` \| `drivers_license`) + `proof_of_address`
- Persistence: `apps/kyc/data/store.json` (gitignored; recreated by seed)

## Later milestones (out of scope here)

- Specialist agent runtimes (M4)
- Cursor Cloud Agents under Builder (M5)
- Verification loops / PR workflow (M6)
- Release Desk UI and demo scenarios (M7)

## GPL-3.0

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
