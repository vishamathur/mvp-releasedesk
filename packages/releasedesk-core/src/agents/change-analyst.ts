import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";

/**
 * Change Analyst — GitHub changes, release notes, impact assessment.
 * Runtime implementation lands in Milestone 4.
 */
export const ChangeAnalystInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.change_analyst),
  repository: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  /** Paths or packages of interest (optional focus). */
  focusPaths: z.array(z.string()).default([]),
});

export type ChangeAnalystInput = z.infer<typeof ChangeAnalystInputSchema>;

export const ChangeFindingSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["added", "modified", "deleted", "renamed", "unknown"]),
  impact: z.enum(["low", "medium", "high", "unknown"]),
  summary: z.string().min(1),
});

export const ChangeAnalystOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.change_analyst),
  releaseNotesDraft: z.string().min(1),
  findings: z.array(ChangeFindingSchema).default([]),
  overallImpact: z.enum(["low", "medium", "high", "unknown"]),
  commitsReviewed: z.number().int().nonnegative().default(0),
});

export type ChangeAnalystOutput = z.infer<typeof ChangeAnalystOutputSchema>;
