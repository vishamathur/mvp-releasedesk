import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";

/**
 * Security Agent — findings/advisories; release-blocking risks.
 *
 * Participation is **mandatory** on every change / release check (see
 * `MANDATORY_ANALYSIS_ROLES` / `evaluateSecurityParticipation` in `@releasedesk/core`).
 * There is no low-risk skip path before human approval.
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
});

export const SecurityAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.security),
  findings: z.array(SecurityFindingSchema).default([]),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
});

export type SecurityAgentOutput = z.infer<typeof SecurityAgentOutputSchema>;
