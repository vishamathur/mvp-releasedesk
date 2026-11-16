import { z } from "zod";
import { AgentRoleSchema } from "./agents/roles.js";
import {
  AuditEventIdSchema,
  RunIdSchema,
  TaskIdSchema,
  createAuditEventId,
  nowIso,
} from "./ids.js";

/**
 * Audit trail hooks — every mutating action on a run should append an event.
 * Persistence is handled by the run-context store; this module defines the shape.
 */
export const AuditActionSchema = z.enum([
  "run.created",
  "run.updated",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "task.created",
  "task.updated",
  "task.started",
  "task.completed",
  "task.failed",
  "task.retrying",
  "task.cancelled",
  "evidence.added",
  "agent.invoked",
  "agent.completed",
  "agent.failed",
  "human.approval_requested",
  "human.approval_recorded",
  "mock.integration_used",
  /** Milestone 6 — verification checkpoints + PR workflow */
  "checkpoint.passed",
  "checkpoint.failed",
  "remediation.cycle_started",
  "pr.opened",
  "pr.tracked",
  "pr.status_polled",
  "pr.merge_blocked",
  /** Feature sign-off checklist (AI-produced code must be manually verified) */
  "feature.detected",
  "feature.signoff_requested",
  "feature.signoff_item_recorded",
  "feature.signoff_completed",
  /** Mandatory Security participation gate */
  "security.gate_evaluated",
  "security.gate_blocked",
  /** Customer intake — Lead started from dual-approved backlog item */
  "intake.lead_started_from_queue",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEventSchema = z.object({
  id: AuditEventIdSchema,
  runId: RunIdSchema,
  action: AuditActionSchema,
  at: z.string().datetime(),
  actor: z.object({
    kind: z.enum(["system", "agent", "human"]),
    agentRole: AgentRoleSchema.optional(),
    name: z.string().optional(),
  }),
  taskId: TaskIdSchema.optional(),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export type CreateAuditEventInput = {
  runId: string;
  action: AuditAction;
  message: string;
  actor?: AuditEvent["actor"];
  taskId?: string;
  details?: Record<string, unknown>;
  id?: string;
  at?: string;
};

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  return AuditEventSchema.parse({
    id: input.id ?? createAuditEventId(),
    runId: input.runId,
    action: input.action,
    at: input.at ?? nowIso(),
    actor: input.actor ?? { kind: "system" },
    message: input.message,
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  });
}

/** Hook interface agents / orchestrators can call without knowing storage. */
export type AuditTrailHook = {
  append(event: CreateAuditEventInput): Promise<AuditEvent> | AuditEvent;
};
