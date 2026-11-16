import { z } from "zod";
import { AiRedTeamFindingSchema, AiRedTeamProviderNameSchema } from "./types.js";

/**
 * SPLX-inspired flow adapted into the Zscaler AI Red Teaming provider home.
 *
 * Optimized shape (not a separate SPLX worker):
 * - **One collapsed gate** runs both pre-release and post-remediation checks
 *   in a single pass (former SPLX Checkpoint 1 + Checkpoint 2).
 * - **Remediation is a non-blocking side queue** — never a stage on the main path.
 * - **Zscaler / MCP red-teaming context** stays attached to the collapsed gate.
 * - **Hard per-iteration approval:** every code iteration needs **red_team** OR
 *   **security** sign-off before it can proceed (no ship without one of the two).
 */

/** Phases executed inside the single collapsed gate (one pass). */
export const AiRedTeamCollapsedGatePhaseSchema = z.enum([
  "pre_release",
  "post_remediation",
]);
export type AiRedTeamCollapsedGatePhase = z.infer<
  typeof AiRedTeamCollapsedGatePhaseSchema
>;

/** Main-path stages only — remediation is intentionally absent. */
export const AiRedTeamMainFlowStageSchema = z.enum([
  "collapsed_gate",
  "human_merge_release",
]);
export type AiRedTeamMainFlowStage = z.infer<typeof AiRedTeamMainFlowStageSchema>;

/** Findings-routing preference (local secrets template / Runtime Secret). */
export const AiRedTeamFindingsRoutingSchema = z.enum([
  "block",
  "warn",
  "report-only",
]);
export type AiRedTeamFindingsRouting = z.infer<typeof AiRedTeamFindingsRoutingSchema>;

/** Either approval kind satisfies the hard per-iteration gate. */
export const IterationApprovalKindSchema = z.enum(["red_team", "security"]);
export type IterationApprovalKind = z.infer<typeof IterationApprovalKindSchema>;

export const IterationApprovalSchema = z.object({
  iterationId: z.string().min(1),
  kind: IterationApprovalKindSchema,
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
  note: z.string().optional(),
});
export type IterationApproval = z.infer<typeof IterationApprovalSchema>;

export const RemediationSideQueueStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);
export type RemediationSideQueueStatus = z.infer<
  typeof RemediationSideQueueStatusSchema
>;

/**
 * Non-blocking remediation item. Main flow must not wait on this queue.
 * `nonBlocking: true` is part of the contract so callers cannot treat it as a stage.
 */
export const RemediationSideQueueItemSchema = z.object({
  id: z.string().min(1),
  iterationId: z.string().min(1),
  findingIds: z.array(z.string().min(1)).default([]),
  status: RemediationSideQueueStatusSchema,
  nonBlocking: z.literal(true),
  enqueuedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  summary: z.string().min(1),
});
export type RemediationSideQueueItem = z.infer<typeof RemediationSideQueueItemSchema>;

/** Zscaler / MCP context attached to the collapsed gate (not a main-flow stage). */
export const AiRedTeamGateContextSchema = z.object({
  provider: AiRedTeamProviderNameSchema,
  /** Optional MCP server / tool label when probes are MCP-backed. */
  mcpContext: z.string().min(1).optional(),
  findingsRouting: AiRedTeamFindingsRoutingSchema.default("report-only"),
});
export type AiRedTeamGateContext = z.infer<typeof AiRedTeamGateContextSchema>;

export const CollapsedGatePhaseResultSchema = z.object({
  phase: AiRedTeamCollapsedGatePhaseSchema,
  findings: z.array(AiRedTeamFindingSchema).default([]),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  summary: z.string().min(1),
});
export type CollapsedGatePhaseResult = z.infer<typeof CollapsedGatePhaseResultSchema>;

export const IterationProceedGateSchema = z.object({
  iterationId: z.string().min(1),
  /** Hard gate: always true — iteration cannot ship without red_team or security. */
  mandatoryApproval: z.literal(true),
  hasRedTeamApproval: z.boolean(),
  hasSecurityApproval: z.boolean(),
  /** True when at least one of red_team | security is present. */
  satisfied: z.boolean(),
  canProceed: z.boolean(),
  blockingIssue: z.string().optional(),
  approvals: z.array(IterationApprovalSchema).default([]),
});
export type IterationProceedGate = z.infer<typeof IterationProceedGateSchema>;

export const CollapsedAiRedTeamGateResultSchema = z.object({
  /** Single gate identity (collapsed former CP1 + CP2). */
  stage: z.literal("collapsed_gate"),
  context: AiRedTeamGateContextSchema,
  /** Both phases run in one pass. */
  phases: z.object({
    pre_release: CollapsedGatePhaseResultSchema,
    post_remediation: CollapsedGatePhaseResultSchema,
  }),
  /** Aggregated release-blocking findings across both phases. */
  releaseBlockingCount: z.number().int().nonnegative(),
  /** Side-queue items enqueued for remediation — main flow does not block on these. */
  remediationSideQueue: z.array(RemediationSideQueueItemSchema).default([]),
  /** Hard per-iteration approval evaluation. */
  iterationProceed: IterationProceedGateSchema,
  /** Main path may continue to human_merge_release only when iterationProceed.canProceed. */
  nextMainStage: AiRedTeamMainFlowStageSchema,
  summary: z.string().min(1),
});
export type CollapsedAiRedTeamGateResult = z.infer<
  typeof CollapsedAiRedTeamGateResultSchema
>;

export type EvaluateIterationProceedInput = {
  iterationId: string;
  approvals: readonly IterationApproval[];
};

/**
 * Hard gate: every code iteration requires red_team **or** security approval.
 * Neither → cannot proceed / cannot ship.
 */
export function evaluateIterationProceedGate(
  input: EvaluateIterationProceedInput,
): IterationProceedGate {
  const forIteration = input.approvals.filter((a) => a.iterationId === input.iterationId);
  const hasRedTeamApproval = forIteration.some((a) => a.kind === "red_team");
  const hasSecurityApproval = forIteration.some((a) => a.kind === "security");
  const satisfied = hasRedTeamApproval || hasSecurityApproval;

  return IterationProceedGateSchema.parse({
    iterationId: input.iterationId,
    mandatoryApproval: true,
    hasRedTeamApproval,
    hasSecurityApproval,
    satisfied,
    canProceed: satisfied,
    ...(satisfied
      ? {}
      : {
          blockingIssue:
            "Iteration hard gate: require red_team approval or security approval before proceeding (neither recorded)",
        }),
    approvals: forIteration,
  });
}

export type RunCollapsedAiRedTeamGateInput = {
  iterationId: string;
  context: AiRedTeamGateContext;
  /** Findings from the pre-release half of the single pass. */
  preReleaseFindings: CollapsedGatePhaseResult["findings"];
  /** Findings from the post-remediation half of the same pass. */
  postRemediationFindings: CollapsedGatePhaseResult["findings"];
  approvals: readonly IterationApproval[];
  /** Clock injection for tests. */
  nowIso?: string;
  /** Id factory for side-queue items (tests). */
  createSideQueueId?: () => string;
};

function phaseResult(
  phase: AiRedTeamCollapsedGatePhase,
  findings: CollapsedGatePhaseResult["findings"],
): CollapsedGatePhaseResult {
  const releaseBlockingCount = findings.filter((f) => f.releaseBlocking).length;
  return CollapsedGatePhaseResultSchema.parse({
    phase,
    findings,
    releaseBlockingCount,
    summary: `${phase}: ${findings.length} finding(s), ${releaseBlockingCount} release-blocking`,
  });
}

function shouldEnqueueRemediation(
  routing: AiRedTeamFindingsRouting,
  releaseBlockingCount: number,
): boolean {
  if (releaseBlockingCount === 0) return false;
  // report-only still records findings but does not enqueue remediation by default.
  if (routing === "report-only") return false;
  // block + warn both enqueue side-queue work; only iteration approval blocks main path.
  return routing === "block" || routing === "warn";
}

/**
 * Run the collapsed single gate: both phases in one pass, attach Zscaler/MCP context,
 * enqueue non-blocking remediation when routing warrants it, and enforce the
 * per-iteration red_team|security approval hard gate before main flow continues.
 */
export function runCollapsedAiRedTeamGate(
  input: RunCollapsedAiRedTeamGateInput,
): CollapsedAiRedTeamGateResult {
  const now = input.nowIso ?? new Date().toISOString();
  const pre = phaseResult("pre_release", input.preReleaseFindings);
  const post = phaseResult("post_remediation", input.postRemediationFindings);
  const releaseBlockingCount = pre.releaseBlockingCount + post.releaseBlockingCount;

  const blockingFindingIds = [
    ...pre.findings.filter((f) => f.releaseBlocking).map((f) => f.id),
    ...post.findings.filter((f) => f.releaseBlocking).map((f) => f.id),
  ];

  const remediationSideQueue: RemediationSideQueueItem[] = [];
  if (
    shouldEnqueueRemediation(input.context.findingsRouting, releaseBlockingCount)
  ) {
    const id =
      input.createSideQueueId?.() ??
      `rt_sideq_${input.iterationId}_${Date.now().toString(36)}`;
    remediationSideQueue.push(
      RemediationSideQueueItemSchema.parse({
        id,
        iterationId: input.iterationId,
        findingIds: blockingFindingIds,
        status: "queued",
        nonBlocking: true,
        enqueuedAt: now,
        updatedAt: now,
        summary: `Non-blocking remediation side-queue for ${blockingFindingIds.length} release-blocking finding(s)`,
      }),
    );
  }

  const iterationProceed = evaluateIterationProceedGate({
    iterationId: input.iterationId,
    approvals: input.approvals,
  });

  // Findings routing=block can still surface in summary, but the hard ship rule is
  // iteration approval. Main path only advances when approval is satisfied.
  const nextMainStage: AiRedTeamMainFlowStage = iterationProceed.canProceed
    ? "human_merge_release"
    : "collapsed_gate";

  const routingNote =
    input.context.findingsRouting === "block" && releaseBlockingCount > 0
      ? `; findingsRouting=block (${releaseBlockingCount} release-blocking)`
      : "";

  return CollapsedAiRedTeamGateResultSchema.parse({
    stage: "collapsed_gate",
    context: input.context,
    phases: {
      pre_release: pre,
      post_remediation: post,
    },
    releaseBlockingCount,
    remediationSideQueue,
    iterationProceed,
    nextMainStage,
    summary: iterationProceed.canProceed
      ? `Collapsed AI Red Team gate passed for iteration ${input.iterationId} (red_team|security approval satisfied); remediation side-queue=${remediationSideQueue.length}${routingNote}`
      : `Collapsed AI Red Team gate holding iteration ${input.iterationId}: ${iterationProceed.blockingIssue ?? "approval required"}${routingNote}`,
  });
}

/** True when a side-queue item is contractually non-blocking. */
export function isNonBlockingRemediation(
  item: RemediationSideQueueItem,
): item is RemediationSideQueueItem & { nonBlocking: true } {
  return item.nonBlocking === true;
}
