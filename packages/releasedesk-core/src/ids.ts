import { randomUUID } from "node:crypto";
import { z } from "zod";

/** Unique release-check / orchestration run id. */
export const RunIdSchema = z
  .string()
  .regex(/^run_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export type RunId = z.infer<typeof RunIdSchema>;

export const TaskIdSchema = z
  .string()
  .regex(/^task_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export type TaskId = z.infer<typeof TaskIdSchema>;

export const EvidenceIdSchema = z
  .string()
  .regex(/^ev_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

export const AuditEventIdSchema = z
  .string()
  .regex(/^aud_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export type AuditEventId = z.infer<typeof AuditEventIdSchema>;

export function createRunId(): RunId {
  return `run_${randomUUID()}`;
}

export function createTaskId(): TaskId {
  return `task_${randomUUID()}`;
}

export function createEvidenceId(): EvidenceId {
  return `ev_${randomUUID()}`;
}

export function createAuditEventId(): AuditEventId {
  return `aud_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
