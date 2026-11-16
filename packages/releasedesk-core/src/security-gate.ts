import type { TaskRecord } from "./task.js";

/**
 * Mandatory Security participation (ITS / SDLC MVP).
 * Security must run and produce a recorded result on every release check —
 * no selective skip for "low risk."
 */

export const MANDATORY_ANALYSIS_ROLES = ["security"] as const;

export type SecurityParticipationResult = {
  ok: boolean;
  securityRan: boolean;
  securityCompleted: boolean;
  hasRecordedResult: boolean;
  blockingIssues: string[];
};

function latestSecurityTask(tasks: readonly TaskRecord[]): TaskRecord | undefined {
  let latest: TaskRecord | undefined;
  for (const task of tasks) {
    if (task.agentRole !== "security") continue;
    if (!latest) {
      latest = task;
      continue;
    }
    const prev = latest.completedAt ?? latest.updatedAt;
    const next = task.completedAt ?? task.updatedAt;
    if (next >= prev) latest = task;
  }
  return latest;
}

/**
 * Evaluate whether Security participated with a recorded result.
 * Missing / failed / empty Security output blocks release readiness.
 */
export function evaluateSecurityParticipation(
  tasks: readonly TaskRecord[],
): SecurityParticipationResult {
  const security = latestSecurityTask(tasks);
  const blockingIssues: string[] = [];

  if (!security) {
    blockingIssues.push(
      "Security: mandatory specialist did not run (no selective skip)",
    );
    return {
      ok: false,
      securityRan: false,
      securityCompleted: false,
      hasRecordedResult: false,
      blockingIssues,
    };
  }

  const securityRan =
    security.status === "completed" ||
    security.status === "failed" ||
    security.status === "running" ||
    security.status === "ready";
  const securityCompleted = security.status === "completed";
  const hasRecordedResult =
    securityCompleted &&
    security.output !== undefined &&
    typeof security.output === "object";

  if (!securityCompleted) {
    blockingIssues.push(
      `Security: mandatory specialist ended as ${security.status} (must complete with a recorded result)`,
    );
  } else if (!hasRecordedResult) {
    blockingIssues.push("Security: completed without a recorded result payload");
  }

  return {
    ok: blockingIssues.length === 0,
    securityRan,
    securityCompleted,
    hasRecordedResult,
    blockingIssues,
  };
}
