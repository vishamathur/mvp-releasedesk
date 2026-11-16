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

// ---------------------------------------------------------------------------
// AI Red Teaming — realtime Lead flags + ATLAS/OWASP hard block
// Distinct from Security (`security`). Label everywhere: "AI Red Teaming".
// ---------------------------------------------------------------------------

export const AI_RED_TEAMING_ROLE = AgentRoleSchema.enum.ai_red_teaming;

/** Stable task-kind labels for AI Red Teaming passes. */
export const AI_RED_TEAMING_TASK_KIND = "ai_red_teaming_pass" as const;

export const AiRedTeamingLeadFlagSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  touchpoint: z.string().min(1),
  passKind: z.enum(["guardrail", "post_builder", "hard_block"]),
  taskId: z.string().optional(),
  findingIds: z.array(z.string()).default([]),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  summary: z.string().min(1),
  /** Lead has routed remediation in response to this flag. */
  remediationRouted: z.boolean().default(false),
});

export type AiRedTeamingLeadFlag = z.infer<typeof AiRedTeamingLeadFlagSchema>;

export const AiRedTeamingFlagRecordSchema = z.object({
  flags: z.array(AiRedTeamingLeadFlagSchema).default([]),
});

export type AiRedTeamingFlagRecord = z.infer<typeof AiRedTeamingFlagRecordSchema>;

export const AiRedTeamingHardBlockStatusSchema = z.enum([
  /** No release-blocking AI Red Teaming findings. */
  "clear",
  /** Findings exist but PR is draft — hard block exempt. */
  "exempt_draft",
  /** Review-ready PR blocked by unresolved ATLAS/OWASP findings. */
  "blocked",
  /** Hard-block pass has not run yet. */
  "not_evaluated",
]);

export type AiRedTeamingHardBlockStatus = z.infer<
  typeof AiRedTeamingHardBlockStatusSchema
>;

export const AiRedTeamingHardBlockGateSchema = z.object({
  role: z.literal(AgentRoleSchema.enum.ai_red_teaming),
  label: z.literal("AI Red Teaming"),
  frameworks: z
    .array(z.enum(["mitre_atlas", "owasp_llm"]))
    .default(["mitre_atlas", "owasp_llm"]),
  status: AiRedTeamingHardBlockStatusSchema,
  /** True when progression must stop (review-ready PR + blocking findings). */
  blocked: z.boolean(),
  /** Draft PRs are exempt from the hard block. */
  draftExempt: z.boolean(),
  prDraft: z.boolean().optional(),
  reviewReady: z.boolean().optional(),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  blockingIssue: z.string().optional(),
  taskId: z.string().optional(),
});

export type AiRedTeamingHardBlockGate = z.infer<
  typeof AiRedTeamingHardBlockGateSchema
>;

function latestAiRedTeamingTask(
  tasks: readonly TaskRecord[],
  passKind?: "guardrail" | "post_builder" | "hard_block",
): TaskRecord | undefined {
  let latest: TaskRecord | undefined;
  for (const task of tasks) {
    if (task.agentRole !== AI_RED_TEAMING_ROLE) continue;
    if (passKind) {
      const kind = task.output?.passKind ?? task.input?.passKind;
      if (kind !== passKind) continue;
    }
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

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Collect release-blocking AI Red Teaming findings across all completed passes.
 * Used for realtime Lead awareness and hard-block evaluation.
 */
export function collectAiRedTeamingBlockingCount(
  tasks: readonly TaskRecord[],
): number {
  let total = 0;
  for (const task of tasks) {
    if (task.agentRole !== AI_RED_TEAMING_ROLE) continue;
    if (task.status !== "completed") continue;
    const count = asNumber(task.output?.releaseBlockingCount) ?? 0;
    total += count;
  }
  return total;
}

/**
 * True when any AI Red Teaming pass asked Lead to be flagged in real time
 * (findings that should interrupt progression for remediation routing).
 */
export function hasRealtimeAiRedTeamingFlags(
  tasks: readonly TaskRecord[],
): boolean {
  for (const task of tasks) {
    if (task.agentRole !== AI_RED_TEAMING_ROLE) continue;
    if (task.status !== "completed") continue;
    if (asBoolean(task.output?.flagLeadRealtime) === true) return true;
    const count = asNumber(task.output?.releaseBlockingCount) ?? 0;
    if (count > 0) return true;
  }
  return false;
}

export function parseAiRedTeamingFlagRecord(raw: unknown): AiRedTeamingFlagRecord {
  const parsed = AiRedTeamingFlagRecordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { flags: [] };
}

/**
 * Evaluate ATLAS/OWASP LLM Top 10 hard block after the dedicated post-Builder
 * AI Red Teaming pass. Draft PRs are exempt; review-ready PRs are blocked when
 * unresolved release-blocking findings remain.
 */
export function evaluateAiRedTeamingHardBlock(input: {
  tasks: readonly TaskRecord[];
  /** When true, PR is still a draft — hard block does not apply. */
  prDraft?: boolean;
  /** When true, PR is review-ready (non-draft). Defaults to !prDraft when omitted. */
  reviewReady?: boolean;
}): AiRedTeamingHardBlockGate {
  const prDraft = input.prDraft === true;
  const reviewReady =
    input.reviewReady !== undefined ? input.reviewReady : !prDraft;

  const hardBlockTask = latestAiRedTeamingTask(input.tasks, "hard_block");
  const postBuilderTask = latestAiRedTeamingTask(input.tasks, "post_builder");
  const evalTask = hardBlockTask ?? postBuilderTask;

  const releaseBlockingCount = (() => {
    if (evalTask?.status === "completed") {
      return asNumber(evalTask.output?.releaseBlockingCount) ?? 0;
    }
    // Fall back to any completed AI Red Teaming passes when hard_block not yet run.
    return collectAiRedTeamingBlockingCount(input.tasks);
  })();

  if (releaseBlockingCount === 0) {
    return AiRedTeamingHardBlockGateSchema.parse({
      role: AI_RED_TEAMING_ROLE,
      label: "AI Red Teaming",
      frameworks: ["mitre_atlas", "owasp_llm"],
      status: evalTask ? "clear" : "not_evaluated",
      blocked: false,
      draftExempt: prDraft,
      prDraft,
      reviewReady,
      releaseBlockingCount: 0,
      ...(evalTask ? { taskId: evalTask.id } : {}),
    });
  }

  if (prDraft || !reviewReady) {
    return AiRedTeamingHardBlockGateSchema.parse({
      role: AI_RED_TEAMING_ROLE,
      label: "AI Red Teaming",
      frameworks: ["mitre_atlas", "owasp_llm"],
      status: "exempt_draft",
      blocked: false,
      draftExempt: true,
      prDraft: true,
      reviewReady: false,
      releaseBlockingCount,
      blockingIssue: `AI Red Teaming: ${releaseBlockingCount} ATLAS/OWASP finding(s) — draft PR exempt from hard block`,
      ...(evalTask ? { taskId: evalTask.id } : {}),
    });
  }

  return AiRedTeamingHardBlockGateSchema.parse({
    role: AI_RED_TEAMING_ROLE,
    label: "AI Red Teaming",
    frameworks: ["mitre_atlas", "owasp_llm"],
    status: "blocked",
    blocked: true,
    draftExempt: false,
    prDraft: false,
    reviewReady: true,
    releaseBlockingCount,
    blockingIssue: `AI Red Teaming: ${releaseBlockingCount} unresolved ATLAS/OWASP LLM Top 10 finding(s) hard-block review-ready PR progression`,
    ...(evalTask ? { taskId: evalTask.id } : {}),
  });
}
