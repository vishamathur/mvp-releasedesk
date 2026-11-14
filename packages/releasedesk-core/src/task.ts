import { z } from "zod";
import { AgentRoleSchema } from "./agents/roles.js";
import { EvidenceItemSchema } from "./evidence.js";
import { TaskIdSchema, createTaskId, nowIso } from "./ids.js";

/**
 * Parallel-safe task lifecycle.
 *
 * - `pending` — created; dependencies not yet satisfied
 * - `ready` — dependencies met; eligible for parallel dispatch
 * - `running` — agent execution in progress
 * - `completed` — finished successfully
 * - `failed` — terminal failure (may still be retried via `retrying`)
 * - `retrying` — scheduled/in-progress retry after failure
 * - `blocked` — cannot proceed (external blocker / human gate)
 * - `cancelled` — intentionally stopped
 */
export const TaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
  "retrying",
  "blocked",
  "cancelled",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export const RetryStateSchema = z.object({
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().optional(),
  nextRetryAt: z.string().datetime().optional(),
});

export type RetryState = z.infer<typeof RetryStateSchema>;

export const FailureInfoSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  failedAt: z.string().datetime(),
  details: z.record(z.unknown()).optional(),
});

export type FailureInfo = z.infer<typeof FailureInfoSchema>;

export const TaskRecordSchema = z.object({
  id: TaskIdSchema,
  runId: z.string().min(1),
  name: z.string().min(1),
  /** Which specialist (or lead) owns this task. */
  agentRole: AgentRoleSchema,
  status: TaskStatusSchema,
  /** Task ids that must reach `completed` before this task becomes `ready`. */
  dependsOn: z.array(TaskIdSchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  retry: RetryStateSchema.optional(),
  failure: FailureInfoSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export type CreateTaskInput = {
  runId: string;
  name: string;
  agentRole: z.infer<typeof AgentRoleSchema>;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  status?: TaskStatus;
  retry?: RetryState;
  id?: string;
};

export function createTaskRecord(input: CreateTaskInput): TaskRecord {
  const ts = nowIso();
  return TaskRecordSchema.parse({
    id: input.id ?? createTaskId(),
    runId: input.runId,
    name: input.name,
    agentRole: input.agentRole,
    status: input.status ?? (input.dependsOn?.length ? "pending" : "ready"),
    dependsOn: input.dependsOn ?? [],
    evidence: [],
    ...(input.input !== undefined ? { input: input.input } : {}),
    ...(input.retry !== undefined ? { retry: input.retry } : {}),
    createdAt: ts,
    updatedAt: ts,
  });
}

/** Returns true when every dependency is in `completed` status. */
export function dependenciesSatisfied(
  task: TaskRecord,
  byId: ReadonlyMap<string, TaskRecord>,
): boolean {
  return task.dependsOn.every((depId) => byId.get(depId)?.status === "completed");
}

/** Tasks that can run in parallel right now. */
export function listReadyTasks(tasks: readonly TaskRecord[]): TaskRecord[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((task) => {
    if (task.status === "ready") return true;
    if (task.status === "pending" && dependenciesSatisfied(task, byId)) return true;
    return false;
  });
}
