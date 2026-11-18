import { AGENT_ROLE_LABELS, type AgentRole } from "./agents/roles.js";
import {
  CURSOR_API_KEY_ENV,
  GROK_API_KEY_ENV,
  type CursorKeyedAgentId,
} from "./agent-credentials.js";

/**
 * Working agent definitions for the SDLC optimization MVP
 * (agility · security · token efficiency).
 *
 * Each definition declares its exclusive API key env var(s) —
 * no shared key across agents.
 */

export type SdlcRequirement = "agility" | "security" | "token_efficiency";

export type SdlcAgentRuntime = "grok_bot" | "cursor_cloud" | "hybrid";

export type SdlcAgentDefinition = {
  id: string;
  role: AgentRole | CursorKeyedAgentId;
  label: string;
  runtime: SdlcAgentRuntime;
  mission: string;
  requirements: SdlcRequirement[];
  /** Exclusive env var(s) for this agent only. */
  apiKeyEnv: string[];
  delegatesTo?: string[];
  usesContextSlice: boolean;
  mandatoryOnEveryChange?: boolean;
};

export const SDLC_LEAD_AGENT: SdlcAgentDefinition = {
  id: "lead",
  role: "lead",
  label: AGENT_ROLE_LABELS.lead,
  runtime: "hybrid",
  mission:
    "Orchestrate on-demand multi-customer release checks; consolidate readiness; request human merge/release gates; never auto-merge.",
  requirements: ["agility", "security", "token_efficiency"],
  apiKeyEnv: [GROK_API_KEY_ENV.lead, CURSOR_API_KEY_ENV.lead],
  delegatesTo: ["change_analyst", "standards", "security", "builder"],
  usesContextSlice: true,
};

export const SDLC_CHANGE_ANALYST_AGENT: SdlcAgentDefinition = {
  id: "change_analyst",
  role: "change_analyst",
  label: AGENT_ROLE_LABELS.change_analyst,
  runtime: "grok_bot",
  mission:
    "Assess GitHub changes, draft release notes, and evidence-backed impact for portfolio apps.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [GROK_API_KEY_ENV.change_analyst],
  usesContextSlice: true,
};

export const SDLC_STANDARDS_AGENT: SdlcAgentDefinition = {
  id: "standards",
  role: "standards",
  label: AGENT_ROLE_LABELS.standards,
  runtime: "grok_bot",
  mission:
    "Check Northwind / client policy corpus; record deviations with evidence before release.",
  requirements: ["agility", "security", "token_efficiency"],
  apiKeyEnv: [GROK_API_KEY_ENV.standards],
  usesContextSlice: true,
};

export const SDLC_SECURITY_AGENT: SdlcAgentDefinition = {
  id: "security",
  role: "security",
  label: AGENT_ROLE_LABELS.security,
  runtime: "grok_bot",
  mission:
    "Mandatory on every change: correlate advisories to components; surface release-blocking risks early so they do not blow delivery windows.",
  requirements: ["security", "agility", "token_efficiency"],
  apiKeyEnv: [GROK_API_KEY_ENV.security],
  usesContextSlice: true,
  mandatoryOnEveryChange: true,
};

export const SDLC_BUILDER_AGENT: SdlcAgentDefinition = {
  id: "builder",
  role: "builder",
  label: AGENT_ROLE_LABELS.builder,
  runtime: "hybrid",
  mission:
    "Turn findings into remediation handoffs; launch Coding / Testing / Review Cloud Agents; track branches and PRs without auto-merge.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [GROK_API_KEY_ENV.builder, CURSOR_API_KEY_ENV.builder],
  delegatesTo: ["coding", "testing", "review"],
  usesContextSlice: true,
};

export const SDLC_CODING_AGENT: SdlcAgentDefinition = {
  id: "coding",
  role: "coding",
  label: "Coding Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Implement remediation changes in-repo under project rules/skills.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [CURSOR_API_KEY_ENV.coding],
  usesContextSlice: true,
};

export const SDLC_TESTING_AGENT: SdlcAgentDefinition = {
  id: "testing",
  role: "testing",
  label: "Testing Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Independently verify Builder/Coding output (distinct from Lead verification checkpoints).",
  requirements: ["agility", "security", "token_efficiency"],
  apiKeyEnv: [CURSOR_API_KEY_ENV.testing],
  usesContextSlice: true,
};

export const SDLC_REVIEW_AGENT: SdlcAgentDefinition = {
  id: "review",
  role: "review",
  label: "Review Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Independently review proposed changes; never merge.",
  requirements: ["security", "token_efficiency"],
  apiKeyEnv: [CURSOR_API_KEY_ENV.review],
  usesContextSlice: true,
};

/** Full catalog: Lead orchestrator + specialist release agents + nested Cloud Agents. */
export const SDLC_AGENT_DEFINITIONS: SdlcAgentDefinition[] = [
  SDLC_LEAD_AGENT,
  SDLC_CHANGE_ANALYST_AGENT,
  SDLC_STANDARDS_AGENT,
  SDLC_SECURITY_AGENT,
  SDLC_BUILDER_AGENT,
  SDLC_CODING_AGENT,
  SDLC_TESTING_AGENT,
  SDLC_REVIEW_AGENT,
];

export function getSdlcAgentDefinition(id: string): SdlcAgentDefinition | undefined {
  return SDLC_AGENT_DEFINITIONS.find((a) => a.id === id);
}

/** Assert no two agents share an API key env var. */
export function assertExclusiveApiKeys(
  defs: readonly SdlcAgentDefinition[] = SDLC_AGENT_DEFINITIONS,
): void {
  const seen = new Map<string, string>();
  for (const def of defs) {
    for (const envVar of def.apiKeyEnv) {
      const prior = seen.get(envVar);
      if (prior) {
        throw new Error(
          `Shared API key env ${envVar} claimed by both ${prior} and ${def.id} — each agent must have its own key`,
        );
      }
      seen.set(envVar, def.id);
    }
  }
}
