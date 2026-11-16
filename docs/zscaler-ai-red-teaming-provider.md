# Zscaler AI Red Teaming provider (optional stub)

Last updated: 2026-11-17 (Asia/Calcutta)

Optional pluggable backend behind the shared **AI Red Teaming** contract in `@releasedesk/core`. Lead can call `custom` and `zscaler` interchangeably via `resolveAiRedTeamingProvider()`.

Research context (Project store): `docs/zscaler-ai-red-teaming-research.md`.

## Config

| Env | Values | Default |
| --- | --- | --- |
| `RELEASEDESK_AI_RED_TEAM_PROVIDER` | `custom` \| `zscaler` | `custom` (off / unset) |

Zscaler is selected **only** when the env is explicitly `zscaler`.

## Local secrets template (gitignored)

Prefer Cursor Apps / Cloud Agent **named Runtime Secrets** for production. For local MOCK/dev wiring only:

| Path | Role |
| --- | --- |
| [`.secrets/zscaler-ai-red-teaming.env.example`](../.secrets/zscaler-ai-red-teaming.env.example) | Committed placeholders |
| `.secrets/zscaler-ai-red-teaming.env` | Local filled copy — **gitignored**; never commit |

Placeholder names: `ZSCALER_AI_RED_TEAM_ENDPOINT`, `ZSCALER_AI_RED_TEAM_API_KEY`, `ZSCALER_AI_RED_TEAM_SCAN_SCOPE`, `ZSCALER_AI_RED_TEAM_FINDINGS_ROUTING` (`block` \| `warn` \| `report-only`).

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

## Usage

```ts
import { resolveAiRedTeamingProvider } from "@releasedesk/core";

const provider = resolveAiRedTeamingProvider(); // custom by default
const result = await provider.runProbes(
  { repository: "vishamathur/mvp-releasedesk", appLabel: "northwind-kyc" },
  ["atlas", "owasp_llm_top_10"],
);
```
