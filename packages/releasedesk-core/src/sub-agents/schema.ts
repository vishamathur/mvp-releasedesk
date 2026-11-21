import { z } from "zod";

/**
 * Parent bots that may delegate to child sub-agents.
 * These are the existing five Release Desk roles. Children are not roles
 * and are not added to the Grok Bot roster.
 */
export const PARENT_BOT_IDS = [
  "lead",
  "change_analyst",
  "standards",
  "security",
  "builder",
] as const;

export const ParentBotIdSchema = z.enum(PARENT_BOT_IDS);
export type ParentBotId = z.infer<typeof ParentBotIdSchema>;

export const SubAgentChildStatusSchema = z.enum([
  "completed",
  "failed",
  "timed_out",
  "skipped",
]);
export type SubAgentChildStatus = z.infer<typeof SubAgentChildStatusSchema>;

/** One child slice after the parent has delegated to it. */
export const SubAgentChildResultSchema = z.object({
  id: z.string().min(1),
  parentId: ParentBotIdSchema,
  responsibility: z.string().min(1),
  status: SubAgentChildStatusSchema,
  summary: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  durationMs: z.number().int().nonnegative(),
  required: z.boolean(),
  parallelGroup: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type SubAgentChildResult = z.infer<typeof SubAgentChildResultSchema>;

export const SubAgentAggregateStatusSchema = z.enum([
  "completed",
  "partial",
  "failed",
]);
export type SubAgentAggregateStatus = z.infer<typeof SubAgentAggregateStatusSchema>;

/**
 * Parent view of every child it delegated to.
 *
 * `securityGateHeld` is a fail-closed flag for the Security parent only.
 * It is not an iteration approval. `evaluateIterationProceedGate` still
 * requires a human `red_team` or `security` sign-off.
 */
export const SubAgentAggregateSchema = z.object({
  parentId: ParentBotIdSchema,
  status: SubAgentAggregateStatusSchema,
  children: z.array(SubAgentChildResultSchema),
  completedIds: z.array(z.string()),
  failedIds: z.array(z.string()),
  timedOutIds: z.array(z.string()),
  skippedIds: z.array(z.string()),
  securityGateHeld: z.boolean(),
  summary: z.string().min(1),
});
export type SubAgentAggregate = z.infer<typeof SubAgentAggregateSchema>;
