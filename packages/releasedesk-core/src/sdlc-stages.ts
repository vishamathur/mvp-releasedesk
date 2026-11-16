import { z } from "zod";
import { nowIso } from "./ids.js";

/**
 * Distinct SDLC pipeline stages after Coding / Builder.
 *
 * Testing  — automated test execution by the Testing Cloud Agent (own box).
 * Verification — independent check of test results + build quality before
 *                Checkpoints + remediate. Never auto-passes merely because
 *                Testing ran or completed.
 */
export const SdlcPipelineStageSchema = z.enum([
  "testing",
  "verification",
]);

export type SdlcPipelineStage = z.infer<typeof SdlcPipelineStageSchema>;

export const SdlcStageStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);

export type SdlcStageStatus = z.infer<typeof SdlcStageStatusSchema>;

export const SdlcStageIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  remediable: z.boolean().default(true),
});

export type SdlcStageIssue = z.infer<typeof SdlcStageIssueSchema>;

/** Evidence produced by the Testing Cloud Agent stage. */
export const TestingStageEvidenceSchema = z.object({
  /** Testing Cloud Agent completed a dispatch (ran), regardless of outcome. */
  testingAgentRan: z.boolean(),
  testsPassed: z.boolean().optional(),
  branch: z.string().optional(),
  cloudAgentId: z.string().optional(),
  cloudRunId: z.string().optional(),
  workItemStatus: z
    .enum(["planned", "dispatched", "completed", "failed"])
    .optional(),
  summary: z.string().optional(),
  sourceTaskId: z.string().optional(),
});

export type TestingStageEvidence = z.infer<typeof TestingStageEvidenceSchema>;

/**
 * Evidence for the independent Verification stage.
 * Intentionally richer than "testing ran" — build quality + explicit pass.
 */
export const VerificationStageEvidenceSchema = z.object({
  testingStageId: z.string().optional(),
  testingStatus: SdlcStageStatusSchema.optional(),
  testingAgentRan: z.boolean().optional(),
  testsPassed: z.boolean().optional(),
  codingCompleted: z.boolean().optional(),
  builderTaskId: z.string().optional(),
  proposedBranch: z.string().optional(),
  proposedPrUrl: z.string().optional(),
  /** True only when Verification applied its own criteria (never inherited). */
  independentDecision: z.literal(true),
});

export type VerificationStageEvidence = z.infer<
  typeof VerificationStageEvidenceSchema
>;

export const SdlcStageResultSchema = z.object({
  id: z.string().min(1),
  stage: SdlcPipelineStageSchema,
  status: SdlcStageStatusSchema,
  at: z.string().datetime(),
  cycle: z.number().int().nonnegative().default(0),
  summary: z.string().min(1),
  issues: z.array(SdlcStageIssueSchema).default([]),
  evidence: z.record(z.unknown()).default({}),
});

export type SdlcStageResult = z.infer<typeof SdlcStageResultSchema>;

export const SdlcStageRecordSchema = z.object({
  stages: z.array(SdlcStageResultSchema).default([]),
});

export type SdlcStageRecord = z.infer<typeof SdlcStageRecordSchema>;

/** Canonical order after Coding: Testing → Verification → (then Checkpoints). */
export const SDLC_POST_CODING_ORDER: readonly SdlcPipelineStage[] = [
  "testing",
  "verification",
] as const;

let stageSeq = 0;

export function createSdlcStageId(stage: SdlcPipelineStage): string {
  stageSeq += 1;
  return `sdlc_${stage}_${stageSeq}_${Date.now()}`;
}

export function parseSdlcStageRecord(raw: unknown): SdlcStageRecord {
  if (!raw || typeof raw !== "object") return { stages: [] };
  const stages = (raw as { stages?: SdlcStageResult[] }).stages;
  return { stages: Array.isArray(stages) ? stages : [] };
}

export function latestSdlcStage(
  record: SdlcStageRecord | undefined,
  stage?: SdlcPipelineStage,
): SdlcStageResult | undefined {
  const list = record?.stages ?? [];
  const filtered = stage ? list.filter((s) => s.stage === stage) : list;
  return filtered[filtered.length - 1];
}

/**
 * Assert Testing precedes Verification in a recorded trail for a cycle.
 * Returns null when order is satisfied or the cycle has no verification yet.
 */
export function assertTestingBeforeVerification(
  record: SdlcStageRecord,
  cycle: number,
): string | null {
  const testing = [...record.stages]
    .reverse()
    .find((s) => s.stage === "testing" && s.cycle === cycle);
  const verification = [...record.stages]
    .reverse()
    .find((s) => s.stage === "verification" && s.cycle === cycle);

  if (!verification) return null;
  if (!testing) {
    return `Verification cycle ${cycle} recorded without a prior Testing stage`;
  }
  if (testing.at > verification.at) {
    return `Testing stage must precede Verification for cycle ${cycle}`;
  }
  return null;
}

export function buildTestingStageResult(input: {
  status: SdlcStageStatus;
  cycle?: number;
  evidence: TestingStageEvidence;
  issues?: SdlcStageIssue[];
  summary?: string;
}): SdlcStageResult {
  const cycle = input.cycle ?? 0;
  const issues = input.issues ?? [];
  const summary =
    input.summary ??
    (input.status === "passed"
      ? `Testing stage passed (cycle ${cycle})`
      : input.status === "failed"
        ? `Testing stage failed (cycle ${cycle})`
        : `Testing stage ${input.status} (cycle ${cycle})`);

  return SdlcStageResultSchema.parse({
    id: createSdlcStageId("testing"),
    stage: "testing",
    status: input.status,
    at: nowIso(),
    cycle,
    summary,
    issues,
    evidence: TestingStageEvidenceSchema.parse(input.evidence),
  });
}

export function buildVerificationStageResult(input: {
  status: Exclude<SdlcStageStatus, "pending" | "running">;
  cycle?: number;
  evidence: Omit<VerificationStageEvidence, "independentDecision"> & {
    independentDecision?: true;
  };
  issues?: SdlcStageIssue[];
  summary?: string;
}): SdlcStageResult {
  const cycle = input.cycle ?? 0;
  const issues = input.issues ?? [];
  const summary =
    input.summary ??
    (input.status === "passed"
      ? `Verification stage passed (cycle ${cycle}) — independent of Testing run alone`
      : input.status === "failed"
        ? `Verification stage failed (cycle ${cycle})`
        : `Verification stage ${input.status} (cycle ${cycle})`);

  return SdlcStageResultSchema.parse({
    id: createSdlcStageId("verification"),
    stage: "verification",
    status: input.status,
    at: nowIso(),
    cycle,
    summary,
    issues,
    evidence: VerificationStageEvidenceSchema.parse({
      ...input.evidence,
      independentDecision: true,
    }),
  });
}
