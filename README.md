# mvp-releasedesk

**Release Desk** will orchestrate release checks for the **Northwind Bank KYC** application. This repository currently delivers **Milestone 1**: a working KYC demo app only.

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
| `npm test` | Run KYC domain unit tests |
| `npm run build` / `npm start` | Production build and serve |

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
  kyc/                 # Northwind Bank KYC (Milestone 1)
packages/              # Reserved for shared libs in later milestones
# later (not in this PR):
#   agents/            # Lead + specialist agents
#   releasedesk/       # Orchestration / UI
```

Root `package.json` uses npm workspaces (`apps/*`, `packages/*`). Keep agent/runtime packages out of `apps/kyc` so release-check tooling can land beside the demo app without a rewrite.

## KYC domain snapshot

- Statuses: `draft` → `submitted` → `in_review` → `approved` | `rejected` | `needs_info`
- Required docs to submit: one government ID (`passport` \| `national_id` \| `drivers_license`) + `proof_of_address`
- Persistence: `apps/kyc/data/store.json` (gitignored; recreated by seed)

## Milestone 2 follow-ups (out of scope here)

- Shared run context and agent I/O contracts
- Lead + specialist agent packages under `agents/` / `packages/`
- Release Desk UI — do not conflate with this KYC app

## GPL-3.0

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
