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

On-demand check with real specialists (Cursor dispatch needs exclusive keys):

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
    // A missing exclusive Grok or Cursor key throws.
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
| **Change Analyst** | Local `git diff` / `git log` for `base...head`; impact heuristics; release-notes draft. An empty git range throws. |
| **Standards** | Loads in-repo Northwind KYC / auth / retention policy markdown, and the industry-neutral website-creation template for website requests from any customer; evaluates deviations with evidence (`policy_ref`). |
| **Security** | Discovers npm components from workspace `package.json`s; correlates + release-blocking flags. A live advisory API is required when advisory hints are present. |
| **Builder** | Turns Lead remediation goals into implementation instructions, then dispatches **Coding → Testing ∥ Review** via Cursor Cloud Agents. Tracks `proposedBranch`, `testsPassed`, `proposedPrUrl`. Never auto-merges. |

Optional Grok enrichment via exclusive `RELEASEDESK_GROK_API_KEY_*` per agent (shared `XAI_API_KEY` / `GROK_API_KEY` never used). A Grok call without that key throws.

## Cursor Cloud Agents (Milestone 5)

Builder plans three handoffs with clear boundaries, then runs:

1. **Coding** (sequential, with retries) — **ships** repo changes (Grok release-intel path)
2. **Testing** and **Review** in parallel after Coding completes — **verify** / **review** only; never merge

Results land on the Builder task output / evidence / `cloudAgentAudit` trail in the shared run context. Lead human **merge** and **release** gates remain pending — Cloud Agents must not merge.

### Real Cursor client

There is no mock client and no `RELEASEDESK_CLOUD_CLIENT` switch. `resolveCloudAgentClient` returns the real client when `RELEASEDESK_CURSOR_API_KEY_CODING`, `RELEASEDESK_CURSOR_API_KEY_TESTING`, and `RELEASEDESK_CURSOR_API_KEY_REVIEW` are set. A missing key throws. Shared `CURSOR_API_KEY` / `CURSOR_SERVICE_ACCOUNT_KEY` are never used. CI does not set the exclusive keys and does not launch agents.

```bash
npm run test:specialists
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
  policies/           # Northwind KYC / retention / auth standards; industry-neutral website-creation template
  release-notes/      # sample notes; an empty git range throws
```

## Layout

```
packages/releasedesk-specialists/
  fixtures/
  src/
    change-analyst.ts, standards.ts, security.ts, builder.ts
    cloud/              # real Cursor Cloud Agent client + dispatch
    runners.ts, git-diff.ts, policy-corpus.ts, advisories.ts
    grok.ts, cli.ts, *.test.ts
  README.md
```

## Milestone 6 — consumed by Lead

Builder `proposedPrUrl` / `testsPassed` / `pr_ref` evidence feed Lead checkpoint verification and PR tracking in `@releasedesk/lead` (real GitHub via `GH_TOKEN`/`GITHUB_TOKEN`). Human merge/release gates remain authoritative — never auto-merge.

## Milestone 7 handoff — Release Desk UI

1. Render Lead `checkpoints`, `pullRequests`, `approvals`, and audit trail in the UI.
2. Demo: fail checkpoint → remediate → pass → pending human approval; rejection path.
3. Poll PR status via `lead.pollPullRequestStatus(runId)`.
4. Do not call merge APIs from the UI — gate decisions only.

Out of scope here: SPLX red teaming.
