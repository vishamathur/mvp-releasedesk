import type { LeadAgentOutput, TaskRecord } from "@releasedesk/core";
import {
  allReleaseGatesApproved,
  anyGateRejected,
  getPendingGates,
  type ApprovalRecord,
} from "./approval.js";

export type SpecialistSnapshot = {
  role: string;
  taskId: string;
  status: string;
  summary?: string;
  output?: Record<string, unknown>;
};

export type ReadinessAssessment = {
  readiness: LeadAgentOutput["readiness"];
  blockingIssues: string[];
  remediationRecommended: boolean;
  specialists: SpecialistSnapshot[];
  summary: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Prefer the latest task per specialist role (reverify supersedes earlier waves). */
export function latestTasksByRole(tasks: readonly TaskRecord[]): TaskRecord[] {
  const byRole = new Map<string, TaskRecord>();
  for (const task of tasks) {
    if (task.agentRole === "lead") continue;
    const prev = byRole.get(task.agentRole);
    if (!prev) {
      byRole.set(task.agentRole, task);
      continue;
    }
    const prevTs = prev.completedAt ?? prev.updatedAt;
    const nextTs = task.completedAt ?? task.updatedAt;
    if (nextTs >= prevTs) byRole.set(task.agentRole, task);
  }
  return [...byRole.values()];
}

/**
 * Consolidate specialist task outputs + approval state into release readiness.
 */
export function assessReadiness(input: {
  tasks: readonly TaskRecord[];
  approvals?: ApprovalRecord;
  /** When true, treat open remediation findings as recommending builder work. */
  considerRemediation?: boolean;
}): ReadinessAssessment {
  const allSpecialists = input.tasks.filter((t) => t.agentRole !== "lead");
  /** Builder history is informative; readiness uses latest per role. */
  const specialistTasks = latestTasksByRole(input.tasks);
  const snapshots: SpecialistSnapshot[] = allSpecialists.map((t) => ({
    role: t.agentRole,
    taskId: t.id,
    status: t.status,
    ...(asString(t.output?.summary) !== undefined
      ? { summary: asString(t.output?.summary) }
      : {}),
    ...(t.output !== undefined ? { output: t.output } : {}),
  }));

  const blockingIssues: string[] = [];
  let remediationRecommended = false;

  for (const task of specialistTasks) {
    if (task.status === "failed" || task.status === "cancelled") {
      blockingIssues.push(`Task ${task.name} (${task.agentRole}) ended as ${task.status}`);
    }
    if (task.status === "blocked") {
      blockingIssues.push(`Task ${task.name} (${task.agentRole}) is blocked`);
    }

    const out = task.output ?? {};
    if (task.agentRole === "standards" && asBoolean(out.compliant) === false) {
      const deviations = Array.isArray(out.deviations) ? out.deviations : [];
      const severe = deviations.filter((d) => {
        const sev = (d as { severity?: string })?.severity;
        return sev === "high" || sev === "critical";
      });
      if (severe.length > 0) {
        blockingIssues.push(`Standards: ${severe.length} high/critical deviation(s)`);
        remediationRecommended = true;
      } else if (deviations.length > 0) {
        remediationRecommended = true;
        blockingIssues.push("Standards: non-compliant with open deviations");
      } else {
        blockingIssues.push("Standards: marked non-compliant");
        remediationRecommended = true;
      }
    }

    if (task.agentRole === "security") {
      const blockingCount = asNumber(out.releaseBlockingCount) ?? 0;
      const risk = asString(out.riskLevel);
      if (blockingCount > 0) {
        blockingIssues.push(`Security: ${blockingCount} release-blocking finding(s)`);
        remediationRecommended = true;
      } else if (risk === "high" || risk === "critical") {
        blockingIssues.push(`Security: elevated risk level (${risk})`);
        remediationRecommended = true;
      }
    }

    if (task.agentRole === "change_analyst") {
      const impact = asString(out.overallImpact);
      if (impact === "high") {
        remediationRecommended = true;
      }
    }
  }

  const approvals = input.approvals;
  if (anyGateRejected(approvals)) {
    blockingIssues.push("Human approval gate rejected");
  }

  const pending = getPendingGates(approvals);
  let readiness: LeadAgentOutput["readiness"];

  if (anyGateRejected(approvals)) {
    readiness = "not_ready";
  } else if (
    blockingIssues.some((b) => b.includes("ended as failed") || b.includes("ended as cancelled"))
  ) {
    readiness = "not_ready";
  } else if (
    blockingIssues.some((b) => b.startsWith("Security:") || b.startsWith("Standards:")) &&
    pending.length === 0 &&
    (approvals?.gates?.length ?? 0) > 0
  ) {
    readiness = "not_ready";
  } else if (pending.length > 0) {
    readiness = "needs_human";
  } else if (allReleaseGatesApproved(approvals) && blockingIssues.length === 0) {
    readiness = "ready";
  } else if (specialistTasks.length === 0) {
    readiness = "unknown";
  } else if (
    specialistTasks
      .filter((t) => t.agentRole !== "builder")
      .every((t) => t.status === "completed") &&
    blockingIssues.length === 0
  ) {
    // Clean specialists but release not approved yet.
    readiness = "needs_human";
  } else if (blockingIssues.length > 0) {
    readiness = "not_ready";
  } else {
    readiness = "unknown";
  }

  if (input.considerRemediation === false) {
    remediationRecommended = false;
  }

  const summaryParts = [
    `Specialists: ${allSpecialists.filter((s) => s.status === "completed").length}/${allSpecialists.length} completed`,
    blockingIssues.length ? `Blocking: ${blockingIssues.length}` : "No blocking issues",
    pending.length ? `Pending approvals: ${pending.length}` : "No pending approvals",
    `Readiness: ${readiness}`,
  ];

  return {
    readiness,
    blockingIssues,
    remediationRecommended,
    specialists: snapshots,
    summary: summaryParts.join(". "),
  };
}
