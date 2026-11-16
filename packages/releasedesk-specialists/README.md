# `@releasedesk/specialists`

Milestone 4–5+ — **specialist + Lead Cloud Agents** for Release Desk.

Change Analyst, Standards, Security, Builder, AI Red Teaming, and **Lead** dispatch through the same pluggable `CloudAgentClient` as Coding/Testing/Review (**MOCK** default). Desk UI triggers Lead **on-demand only** (no queue scheduler). Ephemeral agents share a durable file-backed run context and return independently recorded results (not hardcoded simulated conversations).

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

## How Desk invokes Lead (on-demand Cloud Agent)

```ts
import { FileBackedRunContextStore } from "@releasedesk/core";
import {
  createMockCloudAgentClient,
  startLeadCloudAgent,
} from "@releasedesk/specialists";

const store = new FileBackedRunContextStore("./data/runs.json");
const cloudClient = createMockCloudAgentClient(); // CI-safe default

const { report, leadCloud } = await startLeadCloudAgent({
  store,
  storeUri: store.storePath,
  cloudClient,
  specialists: { cloudClient, storeUri: store.storePath, skipGrok: true },
  check: {
    goal: "Release readiness for Northwind KYC",
    target: {
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "HEAD",
    },
  },
});
// leadCloud.agentKind === "lead"; specialists also dispatched as Cloud Agents
```

`createCloudSpecialistRunners()` wraps each specialist so Lead fans out via `CloudAgentClient`. In MOCK mode the client allocates cloud identity then runs local analysis (no `CURSOR_API_KEY`). Runners still **must not** mutate the store — they return `payload` + `evidence`; Lead persists results.

Legacy `createSpecialistRunners()` (in-process, no cloud dispatch wrapper) remains for unit tests.

## Agents

| Agent | Behavior |
| --- | --- |
| **Change Analyst** | Local `git diff` / `git log` for `base...head`; impact heuristics; release-notes draft. Fixture notes if git empty/unavailable (`MOCK:`). |
| **Standards** | Loads in-repo Northwind policy markdown; evaluates deviations with evidence (`policy_ref`). |
| **Security** | Loads sample advisory JSON; discovers npm components from workspace `package.json`s; correlates + release-blocking flags. Advisory API labeled `MOCK:` when live NVD/OSV unavailable. Distinct from AI Red Teaming. |
| **Builder** | Turns Lead remediation goals into implementation instructions, then dispatches **Coding → Testing ∥ Review** via Cursor Cloud Agents. Tracks `proposedBranch`, `testsPassed`, `proposedPrUrl`. Never auto-merges. |
| **AI Red Teaming** | MITRE ATLAS + OWASP LLM Top 10 guardrail on AI/prompt touchpoints. Uses shared `@releasedesk/core` `AiRedTeamingProvider` (`runProbes` / `healthCheck`; `RELEASEDESK_AI_RED_TEAM_PROVIDER=custom|zscaler`). Flags Lead in real time; post-Builder + hard block (drafts exempt). |

Optional Grok enrichment via `XAI_API_KEY` / `GROK_API_KEY`. Without credentials, local analysis still runs; Grok calls are skipped or `MOCK:`-labeled.

## Cursor Cloud Agents

### Orchestration kinds (Lead + specialists)

| Kind | Trigger |
| --- | --- |
| `lead` | Desk UI on-demand (`startLeadCloudAgent`) — **no scheduler** |
| `change_analyst` / `standards` / `security` / `builder` / `ai_red_teaming` | Lead fans out via `createCloudSpecialistRunners` |

### Builder nested kinds (Milestone 5)

Builder plans three handoffs (`coding`, `testing`, `review`), then runs:

1. **Coding** (sequential, with retries)
2. **Testing** and **Review** in parallel after Coding completes

Results land on the Builder task output / evidence / `cloudAgentAudit` trail in the shared run context. Lead human **merge** and **release** gates remain pending — Cloud Agents must not merge.

### MOCK vs real client

| Mode | How to enable | CI |
| --- | --- | --- |
| **MOCK** (default) | unset `RELEASEDESK_CLOUD_CLIENT`, or set `=mock` | Passes without Cursor credentials |
| **real** | `RELEASEDESK_CLOUD_CLIENT=real` **and** per-agent `RELEASEDESK_CURSOR_API_KEY_*` (see `.env.example`) | Not required for CI |

**NHI tracking:** each Cloud Agent kind has its own secret **name** (`RELEASEDESK_CURSOR_API_KEY_LEAD`, `…_CHANGE_ANALYST`, `…_CODING`, …). Store values as **Cursor named secrets** (Cloud Agent environment Runtime Secrets and/or Apps dashboard) — **no external vault**. Prefer OIDC short-lived credentials where Cursor allows. Legacy shared `CURSOR_API_KEY` is a local/dev fallback only. Zscaler stub name: `RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY`. Details: [`docs/nhi-cursor-secrets.md`](../../docs/nhi-cursor-secrets.md).

```bash
# Default / CI — MOCK client (same interface as real)
npm run test:specialists

# Opt-in live Cursor Cloud Agents API (per-agent NHI keys preferred)
export RELEASEDESK_CURSOR_API_KEY_LEAD=...
export RELEASEDESK_CURSOR_API_KEY_CODING=...
# …see .env.example for the full list
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
