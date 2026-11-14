import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";

/**
 * Standards Agent — Northwind requirements/policies/standards; deviations with evidence.
 * Runtime implementation lands in Milestone 4.
 */
export const StandardsAgentInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.standards),
  repository: z.string().min(1),
  /** Policy / standards corpus identifiers or paths. */
  policyRefs: z.array(z.string()).default([]),
  /** Change Analyst findings or paths to evaluate (optional). */
  changeSummary: z.string().optional(),
});

export type StandardsAgentInput = z.infer<typeof StandardsAgentInputSchema>;

export const StandardsDeviationSchema = z.object({
  policyRef: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  summary: z.string().min(1),
  recommendation: z.string().optional(),
});

export const StandardsAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.standards),
  compliant: z.boolean(),
  deviations: z.array(StandardsDeviationSchema).default([]),
  policiesChecked: z.array(z.string()).default([]),
});

export type StandardsAgentOutput = z.infer<typeof StandardsAgentOutputSchema>;
