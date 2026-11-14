# `@releasedesk/specialists`

Milestone 4–5 — **specialist Agent runners** for Release Desk, including Builder → Cursor Cloud Agents.

Implements Change Analyst, Standards, Security, and Builder as real executions that return independently recorded results for the Lead’s shared run context (not hardcoded simulated conversations).

## Install / test

From the monorepo root:

```bash
npm install
npm run test:specialists
npm run typecheck -w @releasedesk/specialists
npm run build:specialists
```

On-demand check with real specialists (Cloud Agents default to **MOCK**):

```bash
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

## How Lead invokes specialists

```ts
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator } from "@releasedesk/lead";
import { createSpecialistRunners } from "@releasedesk/specialists";

const store = createInMemoryStore();
const lead = new LeadOrchestrator({
  store,
  runners: createSpecialistRunners({
    workspaceRoot: process.cwd(),
    skipGrok: !process.env.XAI_API_KEY,
    // Cloud Agents: omit to use MOCK client (CI-safe).
    // cloudClient: createMockCloudAgentClient(),
  }),
});

const report = await lead.startOnDemandCheck({
  goal: "Release readiness for Northwind KYC",
  target: {
    repository: "vishamathur/mvp-releasedesk",
    baseRef: "main",
    headRef: "HEAD",
  },
});
```

Runners implement `@releasedesk/lead`’s `AgentRunner`. They **must not** mutate the store — they return `payload` + `evidence`; the Lead persists task results onto the run context.

## Agents

| Agent | Behavior |
| --- | --- |
| **Change Analyst** | Local `git diff` / `git log` for `base...head`; impact heuristics; release-notes draft. Fixture notes if git empty/unavailable (`MOCK:`). |
| **Standards** | Loads in-repo Northwind policy markdown; evaluates deviations with evidence (`policy_ref`). |
| **Security** | Loads sample advisory JSON; discovers npm components from workspace `package.json`s; correlates + release-blocking flags. Advisory API labeled `MOCK:` when live NVD/OSV unavailable. |
| **Builder** | Turns Lead remediation goals into implementation instructions, then dispatches **Coding → Testing ∥ Review** via Cursor Cloud Agents. Tracks `proposedBranch`, `testsPassed`, `proposedPrUrl`. Never auto-merges. |

Optional Grok enrichment via `XAI_API_KEY` / `GROK_API_KEY`. Without credentials, local analysis still runs; Grok calls are skipped or `MOCK:`-labeled.

## Cursor Cloud Agents (Milestone 5)

Builder plans three handoffs (`coding`, `testing`, `review`), then runs:

1. **Coding** (sequential, with retries)
2. **Testing** and **Review** in parallel after Coding completes

Results land on the Builder task output / evidence / `cloudAgentAudit` trail in the shared run context. Lead human **merge** and **release** gates remain pending — Cloud Agents must not merge.

### MOCK vs real client

| Mode | How to enable | CI |
| --- | --- | --- |
| **MOCK** (default) | unset `RELEASEDESK_CLOUD_CLIENT`, or set `=mock` | Passes without Cursor credentials |
| **real** | `RELEASEDESK_CLOUD_CLIENT=real` **and** `CURSOR_API_KEY` (or `CURSOR_SERVICE_ACCOUNT_KEY`) | Not required for CI |

```bash
# Default / CI — MOCK client (same interface as real)
npm run test:specialists

# Opt-in live Cursor Cloud Agents API
export CURSOR_API_KEY=...          # Dashboard → API Keys
export RELEASEDESK_CLOUD_CLIENT=real
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

Programmatic injection (tests):

```ts
import {
  createBuilderRunner,
  createMockCloudAgentClient,
  createRealCloudAgentClient,
  resolveCloudAgentClient,
} from "@releasedesk/specialists";

createBuilderRunner({
  cloudClient: createMockCloudAgentClient(),
  cloudMaxAttempts: 2,
});

// Pluggable real client when credentials exist:
resolveCloudAgentClient({
  mode: "real",
  real: { apiKey: process.env.CURSOR_API_KEY },
});
```

Tracked fields on Builder output:

- `proposedBranch` / `branchMetadata.proposedBranch`
- `testsPassed` / `branchMetadata.testsPassed`
- `proposedPrUrl` / `branchMetadata.prUrl`
- `workItems[].status`: `planned` → `dispatched` → `completed` \| `failed`
- `cloudAgentHandoffs[]`, `cloudAgentAudit[]`, `cloudAgentAttempts[]`
- `branchMetadata.autoMerge: false`, `humanMergeGateRequired: true`

## Fixtures

```
fixtures/
  policies/           # Northwind KYC / retention / auth standards
  security/           # sample-advisories.json
  release-notes/      # fallback notes when git range is empty
```

## Layout

```
packages/releasedesk-specialists/
  fixtures/
  src/
    change-analyst.ts, standards.ts, security.ts, builder.ts
    cloud/              # MOCK + real Cursor Cloud Agent clients + dispatch
    runners.ts, git-diff.ts, policy-corpus.ts, advisories.ts
    grok.ts, cli.ts, *.test.ts
  README.md
```

## Milestone 6 — consumed by Lead

Builder `proposedPrUrl` / `testsPassed` / `pr_ref` evidence feed Lead checkpoint verification and PR tracking in `@releasedesk/lead` (MOCK GitHub or real via `GH_TOKEN`/`GITHUB_TOKEN`). Human merge/release gates remain authoritative — never auto-merge.

## Milestone 7 handoff — Release Desk UI

1. Render Lead `checkpoints`, `pullRequests`, `approvals`, and audit trail in the UI.
2. Demo: fail checkpoint → remediate → pass → pending human approval; rejection path.
3. Poll PR status via `lead.pollPullRequestStatus(runId)`.
4. Do not call merge APIs from the UI — gate decisions only.

Out of scope here: SPLX red teaming.
