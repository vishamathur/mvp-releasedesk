import {
  evaluateSecurityParticipation,
  MANDATORY_ANALYSIS_ROLES,
  nowIso,
  type TaskRecord,
} from "@releasedesk/core";
import { assessReadiness, latestTasksByRole } from "./readiness.js";
import type { ApprovalRecord } from "./approval.js";

/**
 * Checkpoint verification after specialist / cloud-agent stages (Milestone 6).
 * Failures drive Lead remediation → reverify loops; never auto-merge.
 */

export type CheckpointStage =
  | "specialist_analysis"
  | "cloud_agents"
  | "post_remediation";

export type CheckpointStatus = "passed" | "failed";

export type CheckpointIssue = {
  code: string;
  message: string;
  /** When true, Lead should schedule remediation. */
  remediable: boolean;
};

export type CheckpointResult = {
  id: string;
  stage: CheckpointStage;
  status: CheckpointStatus;
  at: string;
  cycle: number;
  issues: CheckpointIssue[];
  summary: string;
  evidence: {
    taskIds: string[];
    testsPassed?: boolean;
    proposedPrUrl?: string;
    blockingIssues: string[];
  };
};

export type CheckpointRecord = {
  checkpoints: CheckpointResult[];
};

let checkpointSeq = 0;

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function parseCheckpointRecord(raw: unknown): CheckpointRecord {
  if (!raw || typeof raw !== "object") return { checkpoints: [] };
  const checkpoints = (raw as { checkpoints?: CheckpointResult[] }).checkpoints;
  return { checkpoints: Array.isArray(checkpoints) ? checkpoints : [] };
}

export function latestCheckpoint(
  record: CheckpointRecord | undefined,
  stage?: CheckpointStage,
): CheckpointResult | undefined {
  const list = record?.checkpoints ?? [];
  const filtered = stage ? list.filter((c) => c.stage === stage) : list;
  return filtered[filtered.length - 1];
}

/**
 * Evaluate a verification checkpoint for the given stage.
 * Uses latest specialist outputs (reverify supersedes earlier waves).
 */
export function evaluateCheckpoint(input: {
  stage: CheckpointStage;
  tasks: readonly TaskRecord[];
  cycle?: number;
  approvals?: ApprovalRecord;
}): CheckpointResult {
  checkpointSeq += 1;
  const cycle = input.cycle ?? 0;
  const issues: CheckpointIssue[] = [];
  const latest = latestTasksByRole(input.tasks);
  const taskIds = latest.map((t) => t.id);

  const assessment = assessReadiness({
    tasks: input.tasks,
    approvals: input.approvals,
    considerRemediation: true,
  });

  let testsPassed: boolean | undefined;
  let proposedPrUrl: string | undefined;

  if (input.stage === "specialist_analysis") {
    for (const role of MANDATORY_ANALYSIS_ROLES) {
      const task = latest.find((t) => t.agentRole === role);
      if (!task) {
        issues.push({
          code: "missing_specialist",
          message: `Missing ${role} result for specialist analysis checkpoint`,
          remediable: role !== "security",
        });
        continue;
      }
      if (task.status === "failed" || task.status === "cancelled") {
        issues.push({
          code: "specialist_failed",
          message: `${role} task ended as ${task.status}`,
          remediable: true,
        });
      }
    }

    const securityGate = evaluateSecurityParticipation(input.tasks);
    if (!securityGate.satisfied && securityGate.blockingIssue) {
      issues.push({
        code: "mandatory_security_missing",
        message: securityGate.blockingIssue,
        remediable: securityGate.status === "incomplete" || securityGate.status === "failed",
      });
    }

    for (const issue of assessment.blockingIssues) {
      if (
        issue.startsWith("Security:") ||
        issue.startsWith("Standards:") ||
        issue.startsWith("AI Red Teaming:")
      ) {
        if (issues.some((i) => i.message === issue)) continue;
        issues.push({
          code: "blocking_finding",
          message: issue,
          remediable: true,
        });
      }
    }
  }

  if (input.stage === "cloud_agents" || input.stage === "post_remediation") {
    const builder = latest.find((t) => t.agentRole === "builder");
    if (!builder || builder.status !== "completed") {
      issues.push({
        code: "builder_incomplete",
        message: "Builder / Cloud Agent stage incomplete for checkpoint",
        remediable: true,
      });
    } else {
      const out = builder.output ?? {};
      testsPassed = asBoolean(out.testsPassed);
      proposedPrUrl = asString(out.proposedPrUrl) ?? asString(
        (out.branchMetadata as { prUrl?: unknown } | undefined)?.prUrl,
      );

      if (testsPassed === false) {
        issues.push({
          code: "tests_failed",
          message: "Cloud Agent testing reported testsPassed=false",
          remediable: true,
        });
      }

      const workItems = Array.isArray(out.workItems) ? out.workItems : [];
      const failedItems = workItems.filter(
        (w) => w && typeof w === "object" && (w as { status?: string }).status === "failed",
      );
      if (failedItems.length > 0) {
        issues.push({
          code: "cloud_agent_failed",
          message: `${failedItems.length} Cloud Agent work item(s) failed`,
          remediable: true,
        });
      }

      const autoMerge = (out.branchMetadata as { autoMerge?: unknown } | undefined)?.autoMerge;
      if (autoMerge === true) {
        issues.push({
          code: "auto_merge_forbidden",
          message: "Builder marked autoMerge=true — Release Desk forbids auto-merge",
          remediable: false,
        });
      }
    }
  }

  if (input.stage === "post_remediation") {
    for (const issue of assessment.blockingIssues) {
      if (
        issue.startsWith("Security:") ||
        issue.startsWith("Standards:") ||
        issue.startsWith("AI Red Teaming:")
      ) {
        issues.push({
          code: "reverify_blocking",
          message: issue,
          remediable: true,
        });
      }
    }

    for (const role of ["standards", "security"] as const) {
      const task = latest.find((t) => t.agentRole === role);
      if (task && (task.status === "failed" || task.status === "cancelled")) {
        issues.push({
          code: "reverify_failed",
          message: `Reverify ${role} ended as ${task.status}`,
          remediable: true,
        });
      }
    }

    // Clean reverify should clear releaseBlockingCount / non-compliance.
    const security = latest.find((t) => t.agentRole === "security");
    if (security?.output) {
      const blocking = asNumber(security.output.releaseBlockingCount) ?? 0;
      if (blocking > 0) {
        if (!issues.some((i) => i.code === "reverify_blocking")) {
          issues.push({
            code: "reverify_blocking",
            message: `Security: ${blocking} release-blocking finding(s) after remediation`,
            remediable: true,
          });
        }
      }
    }
  }

  // Deduplicate by message
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const key = `${i.code}:${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const status: CheckpointStatus = deduped.length === 0 ? "passed" : "failed";
  const summary =
    status === "passed"
      ? `Checkpoint ${input.stage} passed (cycle ${cycle})`
      : `Checkpoint ${input.stage} failed (cycle ${cycle}): ${deduped.map((i) => i.message).join("; ")}`;

  return {
    id: `checkpoint_${input.stage}_${checkpointSeq}_${Date.now()}`,
    stage: input.stage,
    status,
    at: nowIso(),
    cycle,
    issues: deduped,
    summary,
    evidence: {
      taskIds,
      ...(testsPassed !== undefined ? { testsPassed } : {}),
      ...(proposedPrUrl !== undefined ? { proposedPrUrl } : {}),
      blockingIssues: assessment.blockingIssues,
    },
  };
}

export function checkpointNeedsRemediation(result: CheckpointResult): boolean {
  return result.status === "failed" && result.issues.some((i) => i.remediable);
}
