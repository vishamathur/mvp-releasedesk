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
| Agent contracts | `agents/*` | Lead, Change Analyst, Standards, Security, Builder I/O |
| Per-agent API keys | `agent-credentials` | Exclusive `RELEASEDESK_GROK_API_KEY_*` / `RELEASEDESK_CURSOR_API_KEY_*` only |
| SDLC agent catalog | `sdlc-agents` | Lead + specialists + Coding/Testing/Review definitions |
| Feature sign-off | `feature-signoff` | Per-feature developer checklist for AI-produced code (`feature_review`) |
| Mandatory gates | `gates` | Security always required on every change (`MANDATORY_ANALYSIS_ROLES`, `evaluateSecurityParticipation`) |
| AI Security frameworks | `ai-security-frameworks` | MITRE ATLAS + OWASP LLM Top 10 hard fails; open-for-review PR merge block (drafts exempt); human waivers |
| AI Red Teaming providers | `ai-red-teaming` | `AiRedTeamingProvider` (`runProbes` / `healthCheck`); `custom` \| `zscaler`; collapsed gate + non-blocking remediation side-queue; per-iteration **red_team \| security** hard approval |

## Per-agent API keys (no shared fallback)

Each SDLC agent resolves credentials from **its own** env var. Shared keys
(`XAI_API_KEY`, `GROK_API_KEY`, `CURSOR_API_KEY`, `CURSOR_SERVICE_ACCOUNT_KEY`)
are **never** consulted for these agents.

| Agent | Exclusive env var(s) |
| --- | --- |
| Lead | `RELEASEDESK_GROK_API_KEY_LEAD`, `RELEASEDESK_CURSOR_API_KEY_LEAD` |
| Change Analyst | `RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST` |
| Standards | `RELEASEDESK_GROK_API_KEY_STANDARDS` |
| Security | `RELEASEDESK_GROK_API_KEY_SECURITY` |
| Builder | `RELEASEDESK_GROK_API_KEY_BUILDER`, `RELEASEDESK_CURSOR_API_KEY_BUILDER` |
| Coding Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_CODING` |
| Testing Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_TESTING` |
| Review Cloud Agent | `RELEASEDESK_CURSOR_API_KEY_REVIEW` |

```ts
import {
  resolveAgentGrokApiKey,
  resolveAgentCursorApiKey,
  SDLC_AGENT_DEFINITIONS,
  assertExclusiveApiKeys,
} from "@releasedesk/core";

assertExclusiveApiKeys(); // throws if any two agents share an env var
const securityKey = resolveAgentGrokApiKey("security"); // only RELEASEDESK_GROK_API_KEY_SECURITY
```

See the repo-root `.env.example` for the full exclusive key list.

## SDLC agents

`SDLC_AGENT_DEFINITIONS` catalogs the Grok Bot Lead (hybrid), analysis specialists
(Change Analyst, Standards, Security — Security is `mandatoryOnEveryChange`), Builder,
and nested Cursor Cloud Agents (Coding, Testing, Review). Each entry lists its exclusive
`apiKeyEnv` values for desk / doctor / provisioning checks.

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

## Agent contracts (plug-in later)

Agents are **not implemented here**. Milestone 3/4 will validate I/O with these schemas:

| Role | Input schema | Output schema |
| --- | --- | --- |
| Lead | `LeadAgentInputSchema` | `LeadAgentOutputSchema` |
| Change Analyst | `ChangeAnalystInputSchema` | `ChangeAnalystOutputSchema` |
| Standards | `StandardsAgentInputSchema` | `StandardsAgentOutputSchema` |
| Security | `SecurityAgentInputSchema` | `SecurityAgentOutputSchema` |
| Builder | `BuilderAgentInputSchema` | `BuilderAgentOutputSchema` |

Typical plug-in shape for a future runner:

1. Lead creates a run via the store and adds specialist tasks (with dependencies as needed).
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
