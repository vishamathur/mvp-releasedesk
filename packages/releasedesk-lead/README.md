# `@releasedesk/lead`

Lead Agent orchestrator for Release Desk (Milestones 3 + 6).

Creates a shared run context, delegates to real specialist runners, runs **checkpoint verification** after specialist and cloud-agent stages, drives **remediation → reverify** loops, tracks pull requests with the real GitHub client, models **human approval gates** (never auto-merge), and consolidates release readiness with a full audit trail. There is no mock mode.

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
# Lead package CLI (real clients; a missing key throws)
npm run check:release:lead -- --repo vishamathur/mvp-releasedesk --json

# Record human gates in memory (no git merge)
npm run check:release:lead -- --repo vishamathur/mvp-releasedesk --approve --json
npm run check:release:lead -- --repo vishamathur/mvp-releasedesk --reject --json

# Full specialists path (root alias → @releasedesk/specialists)
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

### Full check with gates

1. Run `npm run check:release -- --repo vishamathur/mvp-releasedesk --json`
2. Inspect `checkpoints`, `pullRequests`, and pending `approvals`
3. Apply human decisions via `applyApprovalsToReport` / CLI `--approve|--reject` (in-memory) — **never auto-merges**

File-backed store:

```bash
npm run check:release:lead -- --repo vishamathur/mvp-releasedesk --store file --store-path .releasedesk/runs.json
```

## PR workflow

`resolvePrClient()` returns the real GitHub client when `GH_TOKEN` or `GITHUB_TOKEN` is set. A missing token throws. `mergePullRequest` always throws.

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
| ATLAS / OWASP LLM Top 10 | Hard fails on AI findings; block open-for-review PR merge (drafts exempt); human waive only |
| Checkpoint verification | After `specialist_analysis`, `cloud_agents`, `post_remediation` |
| Remediation loop | Builder + standards/security reverify when checkpoints fail |
| PR workflow | Open/track/poll with the real GitHub client; never auto-merge |
| Task status + evidence | Real store mutations |
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
    pr/                   # real GitHub PR client (M6)
    dm-interface.ts, orchestrator.ts, cli.ts, index.ts
    *.test.ts
  README.md
```

## Handoff notes for Milestone 7 (UI)

1. Surface `report.checkpoints`, `report.pullRequests`, `report.featureSignOffs`, and `report.approvals` in the Release Desk UI.
2. Use `lead.pollPullRequestStatus(runId)` for live PR status panels.
3. Wire feature checklist item sign-off to `applyFeatureSignOffsToReport` / `recordFeatureSignOffItem`, and merge/release approve/reject to `applyApprovalsToReport` / `recordHumanApproval` — never call merge APIs; never auto-sign checklists.
4. Demo scenarios: fail checkpoint → remediate → pass → feature checklist → pending merge/release; rejection path; audit timeline.
