# `@releasedesk/lead`

Milestone 3 — **Lead Agent orchestrator** for Release Desk.

Creates a shared run context, delegates to specialist runners (pluggable; MOCK stubs by default), records independent task results/evidence/failures, orchestrates remediation + reverification, models human approval gates, and consolidates release readiness.

Specialist agent implementations (M4), Cursor Cloud wiring (M5), PR automation (M6), and Release Desk UI (M7) are **out of scope**.

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
npm run check:release -- --repo vishamathur/mvp-releasedesk --base main --head HEAD
npm run check:release -- --repo vishamathur/mvp-releasedesk --json
```

File-backed store:

```bash
npm run check:release -- --repo vishamathur/mvp-releasedesk --store file --store-path .releasedesk/runs.json
```

## Programmatic API

```ts
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator, createDefaultStubRunners } from "@releasedesk/lead";

const store = createInMemoryStore();
const lead = new LeadOrchestrator({
  store,
  // Optional: inject real/specialist runners (defaults = MOCK stubs)
  runners: createDefaultStubRunners(),
});

const report = await lead.startOnDemandCheck({
  goal: "Release readiness for Northwind KYC",
  target: {
    repository: "vishamathur/mvp-releasedesk",
    baseRef: "main",
    headRef: "HEAD",
  },
});

console.log(report.runId, report.leadOutput.readiness);
```

### Pluggable `AgentRunner`

```ts
import type { AgentRunner } from "@releasedesk/lead";

const mySecurity: AgentRunner = async ({ runId, taskId, task, run }) => ({
  status: "completed",
  summary: "Security review complete",
  payload: {
    agentRole: "security",
    findings: [],
    releaseBlockingCount: 0,
    riskLevel: "none",
  },
  evidence: [/* CreateEvidenceInput */],
});
```

Runners **must not** mutate the store. The Lead starts/completes/fails tasks and appends evidence so results stay independently recorded on the run context.

## What this package does

| Concern | Behavior |
| --- | --- |
| Unique run IDs | Via `@releasedesk/core` store / `run_` ids |
| Parallel dispatch | Analysis wave (`change_analyst`, `standards`, `security`) via `Promise.all` |
| Task status + evidence | Real store mutations; stubs still write evidence labeled `MOCK:` |
| Retry / failure | `failTask` + retry budget; flaky runners covered in tests |
| Remediation loop | Optional builder task + standards/security reverify |
| Human gates | `merge` + `release` approvals requested; **never** auto-approved |
| DM interface | Text primary; voice stub returns `MOCK:` messages |
| Readiness | `ready` \| `not_ready` \| `needs_human` \| `unknown` |

## Layout

```
packages/releasedesk-lead/
  src/
    agent-runner.ts    # Pluggable runner interface
    stub-runners.ts    # MOCK specialist stubs
    approval.ts        # Human approval gate model
    readiness.ts       # Consolidated readiness assessment
    dm-interface.ts    # Text + MOCK voice
    orchestrator.ts    # LeadOrchestrator
    cli.ts             # On-demand CLI
    *.test.ts
  README.md
```

## Handoff notes for Milestone 4 (specialists)

1. Implement real runners that satisfy `AgentRunner` and validate I/O with `@releasedesk/core` schemas (`ChangeAnalyst*`, `Standards*`, `Security*`, `Builder*`).
2. Inject them into `LeadOrchestrator` via `runners: { change_analyst, standards, security, builder }`.
3. Keep writing evidence through the result object (Lead persists it); label any remaining mocks with `MOCK:` / `mocked: true`.
4. Builder may return `workItems` as `planned` until Cursor Cloud wiring (M5).
5. Prefer replacing stubs one role at a time — tests accept partial `runners` maps.
