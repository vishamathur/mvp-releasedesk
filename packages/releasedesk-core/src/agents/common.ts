import { z } from "zod";
import { EvidenceItemSchema } from "../evidence.js";
import { FailureInfoSchema } from "../task.js";
import { AgentRoleSchema } from "./roles.js";
import { RunIdSchema, TaskIdSchema } from "../ids.js";
import { MockMetaSchema } from "../mock.js";

/** Shared envelope every agent receives. */
export const AgentInvocationBaseSchema = z.object({
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentRole: AgentRoleSchema,
  /** Wall-clock ISO timestamp when the invocation was prepared. */
  invokedAt: z.string().datetime(),
  /** Optional correlation for retries of the same logical task. */
  attempt: z.number().int().nonnegative().default(0),
});

export type AgentInvocationBase = z.infer<typeof AgentInvocationBaseSchema>;

/** Shared result envelope every agent returns. */
export const AgentResultBaseSchema = z.object({
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentRole: AgentRoleSchema,
  status: z.enum(["completed", "failed", "retrying"]),
  completedAt: z.string().datetime(),
  summary: z.string().min(1),
  evidence: z.array(EvidenceItemSchema).default([]),
  failure: FailureInfoSchema.optional(),
  /** Present when the agent relied on mocked integrations. */
  mocksUsed: z.array(MockMetaSchema).default([]),
});

export type AgentResultBase = z.infer<typeof AgentResultBaseSchema>;
