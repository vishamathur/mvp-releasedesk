import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";

/**
 * Builder Agent — remediation → Cursor Cloud Agents; tracks branches, tests, PRs.
 * Runtime / Cursor Cloud wiring lands in Milestones 4–5.
 */
export const BuilderAgentInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.builder),
  repository: z.string().min(1),
  remediationGoals: z.array(z.string().min(1)).min(1),
  baseBranch: z.string().min(1).optional(),
  relatedFindings: z
    .array(
      z.object({
        sourceAgent: AgentRoleSchema,
        summary: z.string().min(1),
        evidenceIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export type BuilderAgentInput = z.infer<typeof BuilderAgentInputSchema>;

export const BuilderWorkItemSchema = z.object({
  kind: z.enum(["coding", "testing", "review"]),
  status: z.enum(["planned", "dispatched", "completed", "failed"]),
  branch: z.string().optional(),
  prUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

/** Explicit evidence that Builder / Cloud Coding introduced a new feature. */
export const BuilderFeatureIntroducedSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  branch: z.string().optional(),
  prUrl: z.string().url().optional(),
});

export const BuilderAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.builder),
  workItems: z.array(BuilderWorkItemSchema).default([]),
  proposedBranch: z.string().optional(),
  proposedPrUrl: z.string().url().optional(),
  testsPassed: z.boolean().optional(),
  /**
   * Optional explicit list of new features introduced by this remediation.
   * When omitted, Lead still detects features from completed coding work items.
   */
  featuresIntroduced: z.array(BuilderFeatureIntroducedSchema).default([]),
});

export type BuilderAgentOutput = z.infer<typeof BuilderAgentOutputSchema>;
export type BuilderFeatureIntroduced = z.infer<typeof BuilderFeatureIntroducedSchema>;
