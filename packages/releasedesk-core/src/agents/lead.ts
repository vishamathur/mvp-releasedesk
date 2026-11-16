import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";
import { TaskIdSchema } from "../ids.js";

/**
 * Lead Agent — orchestrates specialists, tracks results/failures, consolidates
 * release readiness. Runtime implementation lands in Milestone 3.
 */
export const LeadAgentInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.lead),
  goal: z.string().min(1),
  /** Repo / release target under check. */
  target: z.object({
    repository: z.string().min(1),
    baseRef: z.string().min(1).optional(),
    headRef: z.string().min(1).optional(),
    releaseTag: z.string().min(1).optional(),
  }),
  /** Optional human / schedule trigger metadata. */
  trigger: z
    .object({
      kind: z.enum(["scheduled", "on_demand", "remediation"]),
      requestedBy: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

export type LeadAgentInput = z.infer<typeof LeadAgentInputSchema>;

export const LeadDelegationSchema = z.object({
  taskId: TaskIdSchema,
  agentRole: z.enum([
    AgentRoleSchema.enum.change_analyst,
    AgentRoleSchema.enum.standards,
    AgentRoleSchema.enum.security,
    AgentRoleSchema.enum.builder,
    AgentRoleSchema.enum.ai_red_teaming,
  ]),
  rationale: z.string().min(1),
});

export const LeadAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.lead),
  readiness: z.enum(["ready", "not_ready", "needs_human", "unknown"]),
  delegations: z.array(LeadDelegationSchema).default([]),
  blockingIssues: z.array(z.string()).default([]),
  remediationRecommended: z.boolean().default(false),
});

export type LeadAgentOutput = z.infer<typeof LeadAgentOutputSchema>;
