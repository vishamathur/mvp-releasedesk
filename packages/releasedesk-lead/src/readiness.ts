import {
  allFeatureSignOffsComplete,
  evaluateAiFrameworkMergeGate,
  evaluateSecurityParticipation,
  getIncompleteChecklists,
  listUnresolvedFrameworkFindings,
  parseAiFrameworkWaiverRecord,
  type AiFrameworkMergeGate,
  type AiFrameworkWaiverRecord,
  type FeatureSignOffRecord,
  type FrameworkMappedFindingLike,
  type LeadAgentOutput,
  type SecurityParticipationGate,
  type TaskRecord,
} from "@releasedesk/core";
import {
  allReleaseGatesApproved,
  anyGateRejected,
  getPendingGates,
  type ApprovalRecord,
} from "./approval.js";
import { latestSecurityFindings } from "./pr/ai-framework-merge.js";

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
  /** Mandatory Security participation gate — never skippable for low risk. */
  securityGate: SecurityParticipationGate;
  /** MITRE ATLAS / OWASP LLM Top 10 merge gate (drafts exempt from merge block). */
  aiFrameworkMergeGate: AiFrameworkMergeGate;
};

/** Structural checkpoint trail (avoids circular import with verification.ts). */
export type ReadinessCheckpointTrail = {
  checkpoints: Array<{
    stage: string;
    status: "passed" | "failed";
    issues: Array<{ code: string; message: string; remediable: boolean }>;
  }>;
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
 * Consolidate specialist task outputs + feature sign-offs + merge/release
 * approval state into release readiness.
 *
 * Feature checklist sign-off (per AI-produced feature) must complete before
 * run-level merge/release gates can clear readiness to `ready`.
 *
 * Unresolved MITRE ATLAS / OWASP LLM Top 10 findings fail Security and block
 * open-for-review PR merge (drafts exempt) until resolved or human-waived.
 */
export function assessReadiness(input: {
  tasks: readonly TaskRecord[];
  approvals?: ApprovalRecord;
  /** Per-feature developer checklist sign-offs (AI-produced code). */
  featureSignOffs?: FeatureSignOffRecord;
  /** Explicit human waivers for ATLAS/OWASP findings. */
  aiFrameworkWaivers?: AiFrameworkWaiverRecord;
  /** When true, treat open remediation findings as recommending builder work. */
  considerRemediation?: boolean;
  /** Latest checkpoint trail (M6) — failed terminal checkpoints add blockers. */
  checkpoints?: ReadinessCheckpointTrail;
  /** Draft PR exempts ATLAS/OWASP from blocking repository merge. */
  prDraft?: boolean | null;
  prState?: "open" | "closed" | "merged" | null;
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

  const waivers =
    input.aiFrameworkWaivers ??
    parseAiFrameworkWaiverRecord(undefined);
  const findings = latestSecurityFindings(input.tasks);
  const aiFrameworkMergeGate = evaluateAiFrameworkMergeGate({
    findings,
    waivers,
    prDraft: input.prDraft ?? null,
    prState: input.prState ?? "open",
  });

  // Mandatory Security: block readiness if Security did not run or left no result.
  const securityGate = evaluateSecurityParticipation(input.tasks);
  if (!securityGate.satisfied && securityGate.blockingIssue) {
    blockingIssues.push(securityGate.blockingIssue);
  }

  // Hard ATLAS/OWASP findings always fail Security until resolved or waived.
  const unresolved = listUnresolvedFrameworkFindings(findings, waivers);
  if (unresolved.length > 0) {
    blockingIssues.push(
      `Security: ${unresolved.length} unresolved MITRE ATLAS / OWASP LLM Top 10 finding(s) — Security check failed (resolve or human-waive)`,
    );
    remediationRecommended = true;
  }
  if (aiFrameworkMergeGate.blocksPrMerge && aiFrameworkMergeGate.blockingIssue) {
    if (!blockingIssues.includes(aiFrameworkMergeGate.blockingIssue)) {
      blockingIssues.push(aiFrameworkMergeGate.blockingIssue);
    }
  }

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

    if (task.agentRole === "security" && securityGate.satisfied) {
      const blockingCount = asNumber(out.releaseBlockingCount) ?? 0;
      const risk = asString(out.riskLevel);
      const securityFailed = asBoolean(out.securityCheckFailed) === true;
      if (securityFailed && unresolved.length === 0 && blockingCount > 0) {
        blockingIssues.push(`Security: check failed with ${blockingCount} release-blocking finding(s)`);
        remediationRecommended = true;
      } else if (blockingCount > 0 && unresolved.length === 0) {
        blockingIssues.push(`Security: ${blockingCount} release-blocking finding(s)`);
        remediationRecommended = true;
      } else if (risk === "high" || risk === "critical") {
        if (!blockingIssues.some((b) => b.startsWith("Security:"))) {
          blockingIssues.push(`Security: elevated risk level (${risk})`);
          remediationRecommended = true;
        }
      }
    }

    if (task.agentRole === "change_analyst") {
      const impact = asString(out.overallImpact);
      if (impact === "high") {
        remediationRecommended = true;
      }
    }

    if (task.agentRole === "builder" && asBoolean(out.testsPassed) === false) {
      blockingIssues.push("Builder: Cloud Agent testsPassed=false");
      remediationRecommended = true;
    }
  }

  const latestCheckpoint = input.checkpoints?.checkpoints.at(-1);
  if (latestCheckpoint?.status === "failed") {
    for (const issue of latestCheckpoint.issues) {
      const msg = `Checkpoint ${latestCheckpoint.stage}: ${issue.message}`;
      if (!blockingIssues.includes(msg)) blockingIssues.push(msg);
      if (issue.remediable) remediationRecommended = true;
    }
  }

  const approvals = input.approvals;
  const featureSignOffs = input.featureSignOffs;
  const incompleteFeatures = getIncompleteChecklists(featureSignOffs);
  const featuresComplete = allFeatureSignOffsComplete(featureSignOffs);

  if (anyGateRejected(approvals)) {
    blockingIssues.push("Human approval gate rejected");
  }
  if (incompleteFeatures.length > 0) {
    blockingIssues.push(
      `Feature sign-off checklist incomplete: ${incompleteFeatures.length} feature(s) awaiting developer verification`,
    );
  }

  const pending = getPendingGates(approvals);
  let readiness: LeadAgentOutput["readiness"];

  if (anyGateRejected(approvals)) {
    readiness = "not_ready";
  } else if (!securityGate.satisfied) {
    readiness = "not_ready";
  } else if (unresolved.length > 0) {
    // ATLAS/OWASP hard fails — not ready until resolved or waived (merge blocked for open PRs).
    readiness = "not_ready";
  } else if (
    blockingIssues.some((b) => b.includes("ended as failed") || b.includes("ended as cancelled"))
  ) {
    readiness = "not_ready";
  } else if (
    blockingIssues.some((b) => b.startsWith("Security:") || b.startsWith("Standards:")) &&
    pending.length === 0 &&
    featuresComplete &&
    (approvals?.gates?.length ?? 0) > 0
  ) {
    readiness = "not_ready";
  } else if (incompleteFeatures.length > 0 || pending.length > 0) {
    readiness = "needs_human";
  } else if (
    featuresComplete &&
    allReleaseGatesApproved(approvals) &&
    blockingIssues.length === 0
  ) {
    readiness = "ready";
  } else if (specialistTasks.length === 0) {
    readiness = "unknown";
  } else if (
    specialistTasks
      .filter((t) => t.agentRole !== "builder")
      .every((t) => t.status === "completed") &&
    blockingIssues.length === 0
  ) {
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
    `Security gate: ${securityGate.status}`,
    `ATLAS/OWASP merge gate: ${aiFrameworkMergeGate.blocksPrMerge ? "blocks_merge" : aiFrameworkMergeGate.draftExempt ? "draft_exempt" : "clear"}`,
    blockingIssues.length ? `Blocking: ${blockingIssues.length}` : "No blocking issues",
    incompleteFeatures.length
      ? `Pending feature sign-offs: ${incompleteFeatures.length}`
      : "Feature sign-offs complete (or none)",
    pending.length ? `Pending approvals: ${pending.length}` : "No pending approvals",
    `Readiness: ${readiness}`,
  ];

  return {
    readiness,
    blockingIssues,
    remediationRecommended,
    specialists: snapshots,
    summary: summaryParts.join(". "),
    securityGate,
    aiFrameworkMergeGate,
  };
}

export type { FrameworkMappedFindingLike };
