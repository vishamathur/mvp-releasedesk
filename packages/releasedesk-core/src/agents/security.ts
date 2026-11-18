import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";
import { SecurityFrameworkMappingSchema } from "../ai-security-frameworks.js";

/**
 * Security Agent — findings/advisories; release-blocking risks.
 *
 * Participation is **mandatory** on every change / release check (see
 * `MANDATORY_ANALYSIS_ROLES` / `evaluateSecurityParticipation` in `@releasedesk/core`).
 * There is no low-risk skip path before human approval.
 *
 * AI-written code / AI components are reviewed against **MITRE ATLAS** and
 * **OWASP LLM Top 10** as hard guardrails: any mapped finding fails Security
 * and blocks open-for-review PR merge (drafts exempt) until resolved or
 * explicitly human-waived.
 */
export const SecurityAgentInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.security),
  repository: z.string().min(1),
  components: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().optional(),
        ecosystem: z.string().optional(),
      }),
    )
    .default([]),
  /** Optional known CVEs / advisory ids to correlate. */
  advisoryHints: z.array(z.string()).default([]),
  /**
   * Paths / packages known to be AI-written or AI components
   * (agents, LLM clients, prompts, cloud agent handoffs).
   */
  aiComponentHints: z.array(z.string()).default([]),
});

export type SecurityAgentInput = z.infer<typeof SecurityAgentInputSchema>;

export const SecurityFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  component: z.string().optional(),
  advisoryId: z.string().optional(),
  releaseBlocking: z.boolean().default(false),
  /**
   * When true, finding fails Security hard. Always true when frameworkMappings
   * are present (ATLAS / OWASP LLM Top 10).
   */
  hardFail: z.boolean().default(false),
  /** MITRE ATLAS and/or OWASP LLM Top 10 mappings (hard guardrails). */
  frameworkMappings: z.array(SecurityFrameworkMappingSchema).default([]),
});

export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export const SecurityAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.security),
  findings: z.array(SecurityFindingSchema).default([]),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
  /** Reference frameworks applied on this Security pass. */
  frameworksApplied: z
    .array(z.enum(["mitre_atlas", "owasp_llm_top_10"]))
    .default(["mitre_atlas", "owasp_llm_top_10"]),
  /** Count of findings with ATLAS / OWASP LLM mappings (hard fails). */
  frameworkHardFailCount: z.number().int().nonnegative().default(0),
  /** Security check failed due to unresolved framework-mapped findings. */
  securityCheckFailed: z.boolean().default(false),
});

export type SecurityAgentOutput = z.infer<typeof SecurityAgentOutputSchema>;
