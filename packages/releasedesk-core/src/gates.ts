import { z } from "zod";
import { AgentRoleSchema } from "./agents/roles.js";
import type { TaskRecord } from "./task.js";

/**
 * Mandatory specialist participation for every change / release check.
 *
 * Security is never optional: Lead must schedule it on every run, and readiness
 * is blocked until a recorded Security result exists. There is no low-risk skip.
 */

/** Analysis-wave roles Lead must always schedule (parallel; no inter-deps). */
export const MANDATORY_ANALYSIS_ROLES = [
  AgentRoleSchema.enum.change_analyst,
  AgentRoleSchema.enum.standards,
  AgentRoleSchema.enum.security,
] as const;

export type MandatoryAnalysisRole = (typeof MANDATORY_ANALYSIS_ROLES)[number];

/** Security is a required task kind on every change request. */
export const MANDATORY_SECURITY_ROLE = AgentRoleSchema.enum.security;

/** Stable task-kind label for Security participation (contracts / audit). */
export const SECURITY_TASK_KIND = "security_review" as const;

export const SecurityParticipationStatusSchema = z.enum([
  /** Completed Security task with a recorded result (output and/or evidence). */
  "satisfied",
  /** No Security task on the run. */
  "missing",
  /** Security task exists but has not finished. */
  "incomplete",
  /** Security finished without a usable recorded result. */
  "no_recorded_result",
  /** Latest Security task ended failed/cancelled/blocked. */
  "failed",
]);

export type SecurityParticipationStatus = z.infer<
  typeof SecurityParticipationStatusSchema
>;

export const SecurityParticipationGateSchema = z.object({
  /** Always true — documents that Security cannot be skipped. */
  mandatory: z.literal(true),
  role: z.literal(AgentRoleSchema.enum.security),
  taskKind: z.literal(SECURITY_TASK_KIND),
  status: SecurityParticipationStatusSchema,
  satisfied: z.boolean(),
  /** Present when readiness must not proceed past Security. */
  blockingIssue: z.string().optional(),
  taskId: z.string().optional(),
});

export type SecurityParticipationGate = z.infer<typeof SecurityParticipationGateSchema>;

function latestSecurityTask(
  tasks: readonly TaskRecord[],
): TaskRecord | undefined {
  let latest: TaskRecord | undefined;
  for (const task of tasks) {
    if (task.agentRole !== MANDATORY_SECURITY_ROLE) continue;
    if (!latest) {
      latest = task;
      continue;
    }
    const prevTs = latest.completedAt ?? latest.updatedAt;
    const nextTs = task.completedAt ?? task.updatedAt;
    if (nextTs >= prevTs) latest = task;
  }
  return latest;
}

/** True when the task carries a recorded Security result (output and/or evidence). */
export function hasRecordedSecurityResult(task: TaskRecord): boolean {
  if (task.agentRole !== MANDATORY_SECURITY_ROLE) return false;
  if (task.evidence.length > 0) return true;
  const out = task.output;
  if (!out || typeof out !== "object") return false;
  if (out.agentRole === MANDATORY_SECURITY_ROLE) return true;
  if (typeof out.riskLevel === "string") return true;
  if (typeof out.releaseBlockingCount === "number") return true;
  if (Array.isArray(out.findings)) return true;
  if (typeof out.summary === "string" && out.summary.length > 0) return true;
  return false;
}

/**
 * Evaluate whether Security participation evidence is present for readiness.
 * Prefer no skip path: callers must not treat low-risk changes as exempt.
 */
export function evaluateSecurityParticipation(
  tasks: readonly TaskRecord[],
): SecurityParticipationGate {
  const task = latestSecurityTask(tasks);

  if (!task) {
    return SecurityParticipationGateSchema.parse({
      mandatory: true,
      role: MANDATORY_SECURITY_ROLE,
      taskKind: SECURITY_TASK_KIND,
      status: "missing",
      satisfied: false,
      blockingIssue:
        "Security: mandatory Security specialist did not run (no recorded participation)",
    });
  }

  if (
    task.status === "failed" ||
    task.status === "cancelled" ||
    task.status === "blocked"
  ) {
    return SecurityParticipationGateSchema.parse({
      mandatory: true,
      role: MANDATORY_SECURITY_ROLE,
      taskKind: SECURITY_TASK_KIND,
      status: "failed",
      satisfied: false,
      blockingIssue: `Security: mandatory Security task ended as ${task.status}`,
      taskId: task.id,
    });
  }

  if (task.status !== "completed") {
    return SecurityParticipationGateSchema.parse({
      mandatory: true,
      role: MANDATORY_SECURITY_ROLE,
      taskKind: SECURITY_TASK_KIND,
      status: "incomplete",
      satisfied: false,
      blockingIssue: `Security: mandatory Security task is ${task.status} (no recorded result yet)`,
      taskId: task.id,
    });
  }

  if (!hasRecordedSecurityResult(task)) {
    return SecurityParticipationGateSchema.parse({
      mandatory: true,
      role: MANDATORY_SECURITY_ROLE,
      taskKind: SECURITY_TASK_KIND,
      status: "no_recorded_result",
      satisfied: false,
      blockingIssue:
        "Security: mandatory Security task completed without a recorded result",
      taskId: task.id,
    });
  }

  return SecurityParticipationGateSchema.parse({
    mandatory: true,
    role: MANDATORY_SECURITY_ROLE,
    taskKind: SECURITY_TASK_KIND,
    status: "satisfied",
    satisfied: true,
    taskId: task.id,
  });
}

/** Convenience: true only when Security ran and produced a recorded result. */
export function securityParticipationSatisfied(
  tasks: readonly TaskRecord[],
): boolean {
  return evaluateSecurityParticipation(tasks).satisfied;
}

/** Assert the analysis-wave set always includes Security (no selective omit). */
export function assertMandatoryAnalysisRoles(
  roles: readonly string[],
): asserts roles is MandatoryAnalysisRole[] {
  for (const required of MANDATORY_ANALYSIS_ROLES) {
    if (!roles.includes(required)) {
      throw new Error(
        `Mandatory analysis role "${required}" missing from specialist set — Security/guardrails cannot be skipped`,
      );
    }
  }
}
