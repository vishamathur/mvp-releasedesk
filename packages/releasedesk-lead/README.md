# `@releasedesk/lead`

Lead Agent orchestrator for Release Desk (Milestones 3 + 6).

Creates a shared run context, delegates to specialist runners (pluggable; MOCK stubs by default **today**), sequences distinct **Testing** vs **Verification** stages, runs **checkpoint verification** after specialist and cloud-agent stages, drives **remediation → reverify** loops, tracks **PR workflow** (MOCK GitHub or real via token), models **human approval gates** (never auto-merge), and consolidates release readiness with a full audit trail.

**On-demand only:** `startOnDemandCheck` / Desk `/api/checks` / intake `startLeadFromApprovedQueueItem` — there is no backlog queue scheduler. Cursor-maximized target: Lead itself becomes an ephemeral Cloud Agent; Coding/Testing/Review already are.

Prefer `@releasedesk/specialists` (`createSpecialistRunners`) for real specialists + Builder Cloud Agents. Release Desk UI is Milestone 7.

## Install / test

From the monorepo root:

```bash
npm install
npm run test:lead
npm run typecheck -w @releasedesk/lead
npm run build:lead
```

## On-demand check (CLI)

```bash
# Stubs (this package)
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --json

# Demo human gates in-memory (no git merge)
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --approve --json
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --reject --json

# Full specialists path (root alias → @releasedesk/specialists)
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

### Full check with gates

1. Run `npm run check:release -- --repo vishamathur/mvp-releasedesk --json`
2. Inspect `checkpoints`, `pullRequests`, and pending `approvals`
3. Apply human decisions via `applyApprovalsToReport` / CLI `--approve|--reject` (in-memory) — **never auto-merges**

File-backed store:

```bash
npm run check:release:stubs -- --repo vishamathur/mvp-releasedesk --store file --store-path .releasedesk/runs.json
```

## PR workflow (MOCK vs real GitHub)

| Mode | Env |
| --- | --- |
| MOCK (default) | unset `GH_TOKEN` / `GITHUB_TOKEN` |
| real | `GH_TOKEN` or `GITHUB_TOKEN` set |

```ts
import {
  LeadOrchestrator,
  createMockPrClient,
  resolvePrClient,
} from "@releasedesk/lead";

new LeadOrchestrator({
  store,
  prClient: { client: createMockPrClient() }, // tests
  // or omit → resolvePrClient() from env
});
```

`mergePullRequest` always throws. Lead records `pr.merge_blocked` and requires the human merge gate.

## Programmatic API

```ts
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator } from "@releasedesk/lead";

const lead = new LeadOrchestrator({ store: createInMemoryStore() });
const report = await lead.startOnDemandCheck({
  goal: "Release readiness for Northwind KYC",
  target: {
    repository: "vishamathur/mvp-releasedesk",
    baseRef: "main",
    headRef: "HEAD",
  },
});

console.log(report.runId, report.leadOutput.readiness);
console.log(report.checkpoints, report.pullRequests, report.approvals);
```

## What this package does

| Concern | Behavior |
| --- | --- |
| Unique run IDs | Via `@releasedesk/core` store / `run_` ids |
| Parallel dispatch | Analysis wave via `Promise.all` (always includes Security) |
| Mandatory Security | Every change routes Security; readiness blocked without recorded result |
| Testing vs Verification | Testing = Cloud Testing Agent evidence; Verification = independent pass/fail (must not auto-pass) |
| Checkpoint verification | After `specialist_analysis`, `cloud_agents`, `post_remediation` |
| Remediation loop | Builder + standards/security reverify when checkpoints fail |
| PR workflow | Open/track/poll; MOCK or real GitHub; never auto-merge |
| Task status + evidence | Real store mutations; stubs labeled `MOCK:` |
| Retry / failure | `failTask` + retry budget; recorded in audit |
| Feature sign-off | Per AI-produced feature: developer checklist (`feature_review`); **never** auto-signed |
| Human gates | `merge` + `release` (run-level); **never** auto-approved; require feature sign-offs first when features exist |
| Readiness | `ready` \| `not_ready` \| `needs_human` \| `unknown` |

## Layout

```
packages/releasedesk-lead/
  src/
    agent-runner.ts, stub-runners.ts, approval.ts, readiness.ts
    verification.ts       # Checkpoint evaluation (M6)
    pr/                   # GitHub PR client MOCK + real (M6)
    dm-interface.ts, orchestrator.ts, cli.ts, index.ts
    *.test.ts
  README.md
```

## Handoff notes for Milestone 7 (UI)

1. Surface `report.checkpoints`, `report.pullRequests`, `report.featureSignOffs`, and `report.approvals` in the Release Desk UI.
2. Use `lead.pollPullRequestStatus(runId)` for live PR status panels.
3. Wire feature checklist item sign-off to `applyFeatureSignOffsToReport` / `recordFeatureSignOffItem`, and merge/release approve/reject to `applyApprovalsToReport` / `recordHumanApproval` — never call merge APIs; never auto-sign checklists.
4. Demo scenarios: fail checkpoint → remediate → pass → feature checklist → pending merge/release; rejection path; audit timeline.
