# `@releasedesk/core`

Milestone 2 — shared execution context and agent contracts for Release Desk.

This package defines **types**, **Zod schemas**, and a small **run-context store**. It does **not** run agents, wire Cursor Cloud, or ship Release Desk UI (those are later milestones).

## Install / test

From the monorepo root:

```bash
npm install
npm test -w @releasedesk/core
npm run typecheck -w @releasedesk/core
```

## What you get

| Area | Module | Notes |
| --- | --- | --- |
| Unique run / task / evidence / audit IDs | `ids` | Prefixed UUIDs (`run_…`, `task_…`, `ev_…`, `aud_…`) |
| Mock labeling | `mock` | `mocked: true` + `mockLabel`; notes use `MOCK:` prefix |
| Evidence | `evidence` | Structured findings/artifacts attached to tasks |
| Parallel-safe tasks | `task` | Status, `dependsOn`, retry/failure, evidence |
| Audit trail | `audit` | Action enum + events appended on every store mutation |
| Run context | `run-context` | Goal, target repo refs, tasks, audit trail, status |
| Store | `store` | `InMemoryRunContextStore` and `FileBackedRunContextStore` |
| Agent contracts | `agents/*` | Lead, Change Analyst, Standards, Security, Builder, AI Red Teaming I/O |
| Feature sign-off | `feature-signoff` | Per-feature developer checklist for AI-produced code (`feature_review`) |
| Mandatory gates | `gates` | Security always required; AI Red Teaming ATLAS/OWASP hard block (`evaluateAiRedTeamingHardBlock`, drafts exempt) + realtime Lead flags |
| AI Red Teaming providers | `ai-red-teaming` | Shared `AiRedTeamingProvider` (`runProbes` / `healthCheck`); `custom` default + optional `zscaler` via `RELEASEDESK_AI_RED_TEAM_PROVIDER` |
| SDLC stages | `sdlc-stages` | Distinct **Testing** vs **Verification** contracts (Verification must not auto-pass) |

## Run context lifecycle

```ts
import { createInMemoryStore } from "@releasedesk/core";

const store = createInMemoryStore();
const run = await store.create({
  goal: "Release readiness for Northwind KYC",
  target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
});

const { task } = await store.addTask(run.runId, {
  name: "Change analysis",
  agentRole: "change_analyst",
});

await store.startTask(run.runId, task.id);
await store.completeTask(run.runId, task.id, { overallImpact: "low" });
await store.complete(run.runId, "Specialists finished");
```

Supported run statuses: `created` → `running` → `completed` | `failed` | `cancelled`.

Task statuses: `pending` | `ready` | `running` | `completed` | `failed` | `retrying` | `blocked` | `cancelled`.

Tasks with `dependsOn` stay `pending` until dependencies are `completed`, then become `ready` (safe for parallel dispatch of independent work).

Every mutating store method appends an audit event (`run.created`, `task.started`, `agent.invoked`, `mock.integration_used`, …).

## Agent contracts

Schemas live here; runners live in `@releasedesk/lead` / `@releasedesk/specialists` (today in-process; Cursor-maximized target = ephemeral Cloud Agents). Durable file/in-memory stores share run context across on-demand Lead invocations.

| Role | Input schema | Output schema |
| --- | --- | --- |
| Lead | `LeadAgentInputSchema` | `LeadAgentOutputSchema` |
| Change Analyst | `ChangeAnalystInputSchema` | `ChangeAnalystOutputSchema` |
| Standards | `StandardsAgentInputSchema` | `StandardsAgentOutputSchema` |
| Security | `SecurityAgentInputSchema` | `SecurityAgentOutputSchema` |
| Builder | `BuilderAgentInputSchema` | `BuilderAgentOutputSchema` |
| AI Red Teaming | `AiRedTeamingAgentInputSchema` | `AiRedTeamingAgentOutputSchema` |

Typical plug-in shape:

1. Desk/CLI starts Lead **on demand** (no backlog scheduler); Lead creates a run and specialist tasks.
2. Orchestrator starts a ready task, builds a typed `*AgentInput`, invokes the agent runtime.
3. Agent returns a typed `*AgentOutput` (evidence + optional `mocksUsed`).
4. Orchestrator writes evidence / complete / fail on the store (audit trail updates automatically).

## Mocked integrations

When credentials or APIs are unavailable:

- Set `mock: { mocked: true, mockLabel: "<integration>", note?: "MOCK: …" }` on evidence.
- Include the same meta in agent `mocksUsed`.
- Prefer the `MOCK:` prefix on any human-readable fabricated summary (same convention as the KYC app).

## Layout

```
packages/releasedesk-core/
  src/
    ids.ts            # ID helpers
    mock.ts           # MOCK: labeling
    evidence.ts
    task.ts           # parallel-safe task model
    audit.ts          # audit event shapes + hook type
    run-context.ts
    store.ts          # in-memory + file-backed stores
    agents/           # Lead + specialist contracts
    *.test.ts
  README.md
```
