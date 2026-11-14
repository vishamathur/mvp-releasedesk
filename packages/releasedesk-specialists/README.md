# `@releasedesk/specialists`

Milestone 4 — **specialist Agent runners** for Release Desk.

Implements Change Analyst, Standards, Security, and Builder as real executions that return independently recorded results for the Lead’s shared run context (not hardcoded simulated conversations).

## Install / test

From the monorepo root:

```bash
npm install
npm run test:specialists
npm run typecheck -w @releasedesk/specialists
npm run build:specialists
```

On-demand check with real specialists:

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
| **Builder** | Turns Lead remediation goals into implementation instructions + **planned** Cursor Cloud Agent handoff shapes (coding / testing / review). Tracks `proposedBranch`, `testsPassed`, `prUrl` fields (unset until M5/M6). |

Optional Grok enrichment via `XAI_API_KEY` / `GROK_API_KEY`. Without credentials, local analysis still runs; Grok calls are skipped or `MOCK:`-labeled.

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
    runners.ts, git-diff.ts, policy-corpus.ts, advisories.ts
    grok.ts, cli.ts, *.test.ts
  README.md
```

## Milestone 5 handoff — Cursor Cloud Agents

Builder already emits `cloudAgentHandoffs[]` with:

- `agentKind`: `coding` | `testing` | `review`
- `handoffId`, `prompt`, `acceptanceCriteria`
- `repository`, `baseBranch`, `proposedBranch`
- `metadata.cloudAgentApi: "not_wired"`
- work item `status: "planned"`

**M5 should:**

1. Add a Cursor Cloud Agent client (auth, create agent run, poll status).
2. Dispatch each planned handoff; flip work item status `planned` → `dispatched` → `completed` | `failed`.
3. Fill `branchMetadata.testsPassed` and `prUrl` / `proposedPrUrl` from coding/testing/review results.
4. Keep Lead human merge/release gates — Cloud Agents must not auto-merge.
5. Record Cloud Agent run URLs as evidence (`pr_ref` / `artifact`) on the Builder task.

Out of scope here: full PR merge automation UI (M6/M7), SPLX red teaming.
