# Zscaler AI Red Teaming provider (optional stub)

Last updated: 2026-11-18 (Asia/Calcutta)

Optional pluggable backend behind the shared **AI Red Teaming** contract in `@releasedesk/core`. Lead can call `custom` and `zscaler` interchangeably via `resolveAiRedTeamingProvider()`.

Research context (Project store): `docs/zscaler-ai-red-teaming-research.md`.

## Config

| Env | Values | Default |
| --- | --- | --- |
| `RELEASEDESK_AI_RED_TEAM_PROVIDER` | `custom` \| `zscaler` | `custom` (off / unset) |

Zscaler is selected **only** when the env is explicitly `zscaler`.

## Local secrets template (gitignored)

This area is incomplete. The live Zscaler client is **not** implemented. Prefer Cursor Apps / Cloud Agent named Runtime Secrets for any future hosted run. For local MOCK/dev wiring only:

| Path | Role |
| --- | --- |
| [`.secrets/zscaler-ai-red-teaming.env.example`](../.secrets/zscaler-ai-red-teaming.env.example) | Committed placeholders |
| `.secrets/zscaler-ai-red-teaming.env` | Local filled copy — **gitignored**; never commit |

| Name | Status |
| --- | --- |
| `ZSCALER_AI_RED_TEAM_API_KEY` | Recognized as a credential. A non-empty value selects `not_wired` and still makes **no** outbound call |
| `ZSCALER_AI_RED_TEAM_ENDPOINT` | Recorded as configured or not. The URL is not logged and is not requested |
| `ZSCALER_AI_RED_TEAM_SCAN_SCOPE` | Parsed (comma-separated). Not applied to probe selection yet |
| `ZSCALER_AI_RED_TEAM_FINDINGS_ROUTING` | `block` \| `warn` \| `report-only`. Parsed by the stub only. It is not copied into the collapsed gate's `findingsRouting` context and does not change stub findings |

Also still recognized as credentials, unchanged: `ZSCALER_AIRT_API_KEY`, `AIGUARD_API_KEY`.

## Still not done

- No HTTP client, no Zscaler login, no probe upload
- `docs/zscaler-ai-red-teaming-research.md` is referenced below and is not in this repo
- The env routing value is not wired into the collapsed gate. That gate still uses its own `findingsRouting` context, and the iteration gate still requires `red_team` or `security`
- Credentials present → `healthCheck` mode `not_wired`; `runProbes` throws `ZscalerAiRedTeamNotWiredError`

## Contract

```ts
type AiRedTeamingProvider = {
  readonly name: "custom" | "zscaler";
  runProbes(target, frameworks): Promise<AiRedTeamProbeResult>; // findings → ATLAS / OWASP
  healthCheck(): Promise<AiRedTeamHealthCheck>;
};
```

## Modes (Zscaler stub)

| Credentials | Behavior |
| --- | --- |
| Absent (CI / demo) | **MOCK** — sample findings labeled `MOCK:` / `mocked: true`; no network |
| Present (`ZSCALER_AI_RED_TEAM_API_KEY`, `ZSCALER_AIRT_API_KEY`, or `AIGUARD_API_KEY`) | **not wired** — `healthCheck` reports `not_wired`; `runProbes` throws `ZscalerAiRedTeamNotWiredError`. **Never** calls live Zscaler APIs |

## Collapsed gate + side-queue remediation (SPLX pattern, Zscaler home)

Adapted from the SPLX-style checkpoint diagram into **this** provider (no separate SPLX worker):

```text
Main:   [Collapsed AI Red Team Gate] → [Human merge/release]
              │
              ├─ one pass: pre_release + post_remediation checks
              ├─ Zscaler / MCP red-teaming context attached
              └─ hard: every iteration needs red_team OR security approval

Side:   remediation queue (nonBlocking: true)  ← not a main-flow stage
```

| Piece | Implementation |
| --- | --- |
| Collapsed gate | `runCollapsedAiRedTeamGate()` — both `pre_release` and `post_remediation` phases in **one** result |
| Side-queue remediation | `remediationSideQueue[]` with `nonBlocking: true`; main path does not wait |
| Per-iteration hard approval | `evaluateIterationProceedGate()` — **must** have `red_team` **or** `security` approval; otherwise `canProceed=false` and `nextMainStage` stays `collapsed_gate` |
| Gate context | `AiRedTeamGateContext` — `provider`, optional `mcpContext`, `findingsRouting` (`block` \| `warn` \| `report-only`) |

Helpers live in `@releasedesk/core` → `ai-red-teaming/checkpoint-gate.ts`.

## Usage

```ts
import {
  resolveAiRedTeamingProvider,
  runCollapsedAiRedTeamGate,
} from "@releasedesk/core";

const provider = resolveAiRedTeamingProvider(); // custom by default
const probe = await provider.runProbes(
  { repository: "vishamathur/mvp-releasedesk", appLabel: "northwind-kyc" },
  ["atlas", "owasp_llm_top_10"],
);

const gate = runCollapsedAiRedTeamGate({
  iterationId: "iter_42",
  context: {
    provider: provider.name,
    mcpContext: "zscaler-mcp-red-team",
    findingsRouting: "block",
  },
  preReleaseFindings: probe.findings,
  postRemediationFindings: [], // same pass — fill when re-check data exists
  approvals: [
    /* require red_team or security before canProceed */
  ],
});
```
