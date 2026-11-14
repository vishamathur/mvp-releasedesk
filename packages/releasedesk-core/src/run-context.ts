import { z } from "zod";
import { AgentRoleSchema } from "./agents/roles.js";
import { AuditEventSchema } from "./audit.js";
import { createRunId, nowIso, RunIdSchema } from "./ids.js";
import { TaskRecordSchema } from "./task.js";

export const RunStatusSchema = z.enum([
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunContextSchema = z.object({
  runId: RunIdSchema,
  status: RunStatusSchema,
  /** Human-readable goal for this release check. */
  goal: z.string().min(1),
  target: z.object({
    repository: z.string().min(1),
    baseRef: z.string().optional(),
    headRef: z.string().optional(),
    releaseTag: z.string().optional(),
  }),
  /** Parallel-safe task graph for specialist work. */
  tasks: z.array(TaskRecordSchema).default([]),
  /** Append-only audit trail for this run. */
  auditTrail: z.array(AuditEventSchema).default([]),
  /** Optional metadata (trigger, labels, etc.). */
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  failure: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});

export type RunContext = z.infer<typeof RunContextSchema>;

export type CreateRunContextInput = {
  goal: string;
  target: RunContext["target"];
  metadata?: Record<string, unknown>;
  runId?: string;
};

export function createRunContext(input: CreateRunContextInput): RunContext {
  const ts = nowIso();
  return RunContextSchema.parse({
    runId: input.runId ?? createRunId(),
    status: "created",
    goal: input.goal,
    target: input.target,
    tasks: [],
    auditTrail: [],
    metadata: input.metadata ?? {},
    createdAt: ts,
    updatedAt: ts,
  });
}

export function touchRun(run: RunContext, patch: Partial<RunContext>): RunContext {
  return RunContextSchema.parse({
    ...run,
    ...patch,
    runId: run.runId,
    updatedAt: nowIso(),
  });
}

/** Roles that may be scheduled as independent specialist tasks under a Lead. */
export const SPECIALIST_ROLES = [
  AgentRoleSchema.enum.change_analyst,
  AgentRoleSchema.enum.standards,
  AgentRoleSchema.enum.security,
  AgentRoleSchema.enum.builder,
] as const;
