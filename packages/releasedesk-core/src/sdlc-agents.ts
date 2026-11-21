import { AGENT_ROLE_LABELS, type AgentRole } from "./agents/roles.js";
import { type CursorKeyedAgentId } from "./agent-credentials.js";

/**
 * Working agent definitions for the SDLC optimization MVP
 * (agility · security · token efficiency).
 *
 * Bots do not hold API keys. The shipped Grok call reads `XAI_API_KEY`
 * in application code. Cursor cloud agents are launched by the Builder
 * Grok Bot, not by a per-agent Cursor key.
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
  /** Always empty. Per-bot keys are retired. */
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
    "Own PID state in the Grok Bot app. Hand stages to teammates. Request human gates. Never auto-approve or merge.",
  requirements: ["agility", "security", "token_efficiency"],
  apiKeyEnv: [],
  delegatesTo: ["change_analyst", "standards", "security", "builder"],
  usesContextSlice: true,
};

export const SDLC_CHANGE_ANALYST_AGENT: SdlcAgentDefinition = {
  id: "change_analyst",
  role: "change_analyst",
  label: AGENT_ROLE_LABELS.change_analyst,
  runtime: "grok_bot",
  mission:
    "Estimate changes, and for new customers run discovery and scope. Evidence-backed only.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [],
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
  apiKeyEnv: [],
  usesContextSlice: true,
};

export const SDLC_SECURITY_AGENT: SdlcAgentDefinition = {
  id: "security",
  role: "security",
  label: AGENT_ROLE_LABELS.security,
  runtime: "grok_bot",
  mission:
    "Mandatory on every change: correlate advisories to components; prepare the red_team|security packet. Never sign the human gate.",
  requirements: ["security", "agility", "token_efficiency"],
  apiKeyEnv: [],
  usesContextSlice: true,
  mandatoryOnEveryChange: true,
};

export const SDLC_BUILDER_AGENT: SdlcAgentDefinition = {
  id: "builder",
  role: "builder",
  label: AGENT_ROLE_LABELS.builder,
  runtime: "hybrid",
  mission:
    "Launch the Cursor cloud agent for the build stage under repo rules and skills. Return the PR and test result to Lead. Never merge.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [],
  delegatesTo: ["coding", "testing", "review"],
  usesContextSlice: true,
};

export const SDLC_CODING_AGENT: SdlcAgentDefinition = {
  id: "coding",
  role: "coding",
  label: "Coding Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Implement remediation changes in-repo under project rules/skills. Ships code that calls the Grok API.",
  requirements: ["agility", "token_efficiency"],
  apiKeyEnv: [],
  usesContextSlice: true,
};

export const SDLC_TESTING_AGENT: SdlcAgentDefinition = {
  id: "testing",
  role: "testing",
  label: "Testing Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Independently verify Builder/Coding output (distinct from Lead verification checkpoints).",
  requirements: ["agility", "security", "token_efficiency"],
  apiKeyEnv: [],
  usesContextSlice: true,
};

export const SDLC_REVIEW_AGENT: SdlcAgentDefinition = {
  id: "review",
  role: "review",
  label: "Review Cloud Agent",
  runtime: "cursor_cloud",
  mission: "Independently review proposed changes; never merge.",
  requirements: ["security", "token_efficiency"],
  apiKeyEnv: [],
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

/**
 * Bots must not claim API key env vars. Throws if any definition lists one.
 */
export function assertExclusiveApiKeys(
  defs: readonly SdlcAgentDefinition[] = SDLC_AGENT_DEFINITIONS,
): void {
  for (const def of defs) {
    if (def.apiKeyEnv.length > 0) {
      throw new Error(
        `${def.id} lists API key env ${def.apiKeyEnv.join(", ")} — per-bot keys are retired; use the app XAI_API_KEY only in shipped code`,
      );
    }
  }
}
