import { formatMockNote, nowIso, type TaskRecord } from "@releasedesk/core";
import { latestTasksByRole } from "./readiness.js";

/**
 * Rollback plan — adaptability hook for release readiness.
 * Produces a concrete rollback recipe from target tags + change impact.
 * Does not execute rollback; humans decide via existing merge/release gates.
 */

export type RollbackStep = {
  order: number;
  action: string;
  owner: "ops" | "dev" | "lead" | "human";
  automated: boolean;
  detail: string;
};

export type RollbackPlan = {
  id: string;
  status: "planned" | "recommended" | "not_applicable";
  generatedAt: string;
  repository: string;
  currentHead: string;
  previousReleaseTag: string;
  riskLevel: "low" | "medium" | "high" | "unknown";
  rationale: string;
  steps: RollbackStep[];
  mocked: boolean;
};

export type RollbackRecord = {
  plans: RollbackPlan[];
};

let rollbackSeq = 0;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asImpact(value: unknown): RollbackPlan["riskLevel"] {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export function parseRollbackRecord(raw: unknown): RollbackRecord {
  if (!raw || typeof raw !== "object") return { plans: [] };
  const plans = (raw as { plans?: RollbackPlan[] }).plans;
  return { plans: Array.isArray(plans) ? plans : [] };
}

export function latestRollbackPlan(record: RollbackRecord | undefined): RollbackPlan | undefined {
  const plans = record?.plans ?? [];
  return plans[plans.length - 1];
}

export function buildRollbackPlan(input: {
  tasks: readonly TaskRecord[];
  repository: string;
  headRef?: string;
  releaseTag?: string;
  previousReleaseTag?: string;
}): RollbackPlan {
  rollbackSeq += 1;
  const latest = latestTasksByRole(input.tasks);
  const analyst = latest.find((t) => t.agentRole === "change_analyst");
  const security = latest.find((t) => t.agentRole === "security");

  const overallImpact = asImpact(analyst?.output?.overallImpact);
  const blockingCount =
    typeof security?.output?.releaseBlockingCount === "number"
      ? security.output.releaseBlockingCount
      : 0;

  let riskLevel: RollbackPlan["riskLevel"] = overallImpact;
  if (blockingCount > 0) riskLevel = "high";
  else if (overallImpact === "high") riskLevel = "high";
  else if (overallImpact === "medium") riskLevel = "medium";
  else if (overallImpact === "low") riskLevel = "low";

  const previousReleaseTag =
    input.previousReleaseTag ??
    (input.releaseTag ? `${input.releaseTag}^` : "previous-release");
  const currentHead = input.headRef ?? input.releaseTag ?? "HEAD";

  const mocked = !input.previousReleaseTag && !input.releaseTag;

  const steps: RollbackStep[] = [
    {
      order: 1,
      action: "Freeze merges to release branch",
      owner: "human",
      automated: false,
      detail: "Hold merge/release gates; do not promote further commits",
    },
    {
      order: 2,
      action: "Redeploy previous known-good tag",
      owner: "ops",
      automated: false,
      detail: mocked
        ? formatMockNote(`Redeploy tag ${previousReleaseTag} (tag inferred — MOCK)`)
        : `Redeploy tag ${previousReleaseTag}`,
    },
    {
      order: 3,
      action: "Verify KYC smoke path",
      owner: "dev",
      automated: false,
      detail: "Create → documents → submit → review still healthy after rollback",
    },
    {
      order: 4,
      action: "Open hotfix / remediation follow-up",
      owner: "lead",
      automated: false,
      detail: "Schedule Release Desk remediation check against the failed head",
    },
  ];

  const status: RollbackPlan["status"] =
    riskLevel === "high" || blockingCount > 0 ? "recommended" : "planned";

  const rationaleParts = [
    `Impact from Change Analyst: ${overallImpact}`,
    blockingCount > 0
      ? `Security release-blocking findings: ${blockingCount}`
      : "No security release-blocking count",
    mocked
      ? formatMockNote("Previous release tag not supplied; using inferred placeholder")
      : `Previous tag: ${previousReleaseTag}`,
  ];

  return {
    id: `rollback_${rollbackSeq}_${Date.now()}`,
    status,
    generatedAt: nowIso(),
    repository: input.repository,
    currentHead,
    previousReleaseTag,
    riskLevel,
    rationale: rationaleParts.join(". "),
    steps,
    mocked,
  };
}
