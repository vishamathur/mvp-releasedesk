import {
  assertTestingBeforeVerification,
  buildTestingStageResult,
  buildVerificationStageResult,
  parseSdlcStageRecord,
  type SdlcStageIssue,
  type SdlcStageRecord,
  type SdlcStageResult,
  type TaskRecord,
  type TestingStageEvidence,
} from "@releasedesk/core";

/**
 * Distinct Testing + Verification stages (post-Coding, pre-Checkpoints).
 *
 * Testing — Testing Cloud Agent executed automated tests (status + evidence).
 * Verification — independent pass/fail on test results + build quality.
 * Never auto-passes Verification merely because Testing ran/completed.
 */

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function latestBuilder(tasks: readonly TaskRecord[]): TaskRecord | undefined {
  const builders = tasks.filter((t) => t.agentRole === "builder");
  return builders[builders.length - 1];
}

function testingWorkItem(
  builder: TaskRecord | undefined,
): Record<string, unknown> | undefined {
  const workItems = Array.isArray(builder?.output?.workItems)
    ? builder!.output!.workItems
    : [];
  for (const item of workItems) {
    if (
      item &&
      typeof item === "object" &&
      (item as { kind?: string }).kind === "testing"
    ) {
      return item as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * Record Testing stage from Testing Cloud Agent evidence on the Builder task.
 * Status reflects whether the Testing agent ran and whether testsPassed.
 */
export function evaluateTestingStage(input: {
  tasks: readonly TaskRecord[];
  cycle?: number;
}): SdlcStageResult {
  const cycle = input.cycle ?? 0;
  const builder = latestBuilder(input.tasks);
  const issues: SdlcStageIssue[] = [];

  if (!builder || builder.status !== "completed") {
    issues.push({
      code: "testing_missing_builder",
      message: "Testing stage requires a completed Builder / Coding stage",
      remediable: true,
    });
    return buildTestingStageResult({
      status: "failed",
      cycle,
      issues,
      evidence: { testingAgentRan: false },
      summary: `Testing stage failed (cycle ${cycle}): Builder incomplete`,
    });
  }

  const testingItem = testingWorkItem(builder);
  const testsPassed =
    asBoolean(builder.output?.testsPassed) ??
    asBoolean(
      (builder.output?.branchMetadata as { testsPassed?: unknown } | undefined)
        ?.testsPassed,
    );
  const workItemStatus = asString(testingItem?.status) as
    | TestingStageEvidence["workItemStatus"]
    | undefined;
  const testingAgentRan =
    workItemStatus === "completed" ||
    workItemStatus === "failed" ||
    workItemStatus === "dispatched" ||
    testsPassed !== undefined;

  const evidence: TestingStageEvidence = {
    testingAgentRan,
    ...(testsPassed !== undefined ? { testsPassed } : {}),
    ...(asString(builder.output?.proposedBranch)
      ? { branch: asString(builder.output?.proposedBranch) }
      : {}),
    ...(workItemStatus ? { workItemStatus } : {}),
    ...(asString(testingItem?.notes) ? { summary: asString(testingItem?.notes) } : {}),
    sourceTaskId: builder.id,
  };

  if (!testingAgentRan) {
    issues.push({
      code: "testing_agent_did_not_run",
      message: "Testing Cloud Agent did not run (no testing work item / testsPassed)",
      remediable: true,
    });
  }
  if (workItemStatus === "failed") {
    issues.push({
      code: "testing_agent_failed",
      message: "Testing Cloud Agent work item failed",
      remediable: true,
    });
  }
  if (testsPassed === false) {
    issues.push({
      code: "tests_failed",
      message: "Testing Cloud Agent reported testsPassed=false",
      remediable: true,
    });
  }

  const status =
    issues.length === 0 && testingAgentRan && testsPassed !== false
      ? "passed"
      : "failed";

  return buildTestingStageResult({
    status,
    cycle,
    issues,
    evidence,
  });
}

/**
 * Independent Verification of test results + build quality.
 * Explicitly does **not** pass just because Testing ran or completed.
 */
export function evaluateVerificationStage(input: {
  tasks: readonly TaskRecord[];
  testingStage: SdlcStageResult;
  cycle?: number;
}): SdlcStageResult {
  const cycle = input.cycle ?? 0;
  const builder = latestBuilder(input.tasks);
  const testing = input.testingStage;
  const testingEvidence = testing.evidence as TestingStageEvidence;
  const issues: SdlcStageIssue[] = [];

  // Order: Verification must follow a recorded Testing stage (same cycle).
  if (testing.stage !== "testing") {
    issues.push({
      code: "verification_requires_testing_stage",
      message: "Verification requires a distinct Testing stage result",
      remediable: false,
    });
  }

  // Critical: Testing having run is NEVER sufficient alone.
  if (testingEvidence.testingAgentRan === true && testingEvidence.testsPassed !== true) {
    issues.push({
      code: "verification_tests_not_passed",
      message:
        "Verification failed: Testing ran but testsPassed is not true (no auto-pass on run alone)",
      remediable: true,
    });
  }

  if (testingEvidence.testsPassed !== true) {
    if (!issues.some((i) => i.code === "verification_tests_not_passed")) {
      issues.push({
        code: "verification_missing_pass",
        message: "Verification requires explicit testsPassed=true evidence",
        remediable: true,
      });
    }
  }

  if (testing.status === "failed") {
    issues.push({
      code: "verification_upstream_testing_failed",
      message: "Verification cannot pass while Testing stage failed",
      remediable: true,
    });
  }

  const codingItem = Array.isArray(builder?.output?.workItems)
    ? builder!.output!.workItems.find(
        (w) => w && typeof w === "object" && (w as { kind?: string }).kind === "coding",
      )
    : undefined;
  const codingCompleted =
    codingItem !== undefined &&
    typeof codingItem === "object" &&
    (codingItem as { status?: string }).status === "completed";

  if (!codingCompleted) {
    issues.push({
      code: "verification_build_incomplete",
      message: "Verification failed: Coding Cloud Agent build not completed",
      remediable: true,
    });
  }

  const autoMerge = (
    builder?.output?.branchMetadata as { autoMerge?: unknown } | undefined
  )?.autoMerge;
  if (autoMerge === true) {
    issues.push({
      code: "verification_auto_merge_forbidden",
      message: "Verification failed: autoMerge=true is forbidden",
      remediable: false,
    });
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const key = `${i.code}:${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const status = deduped.length === 0 ? "passed" : "failed";

  return buildVerificationStageResult({
    status,
    cycle,
    issues: deduped,
    evidence: {
      testingStageId: testing.id,
      testingStatus: testing.status,
      testingAgentRan: testingEvidence.testingAgentRan,
      testsPassed: testingEvidence.testsPassed,
      codingCompleted,
      builderTaskId: builder?.id,
      proposedBranch: asString(builder?.output?.proposedBranch),
      proposedPrUrl: asString(builder?.output?.proposedPrUrl),
    },
    summary:
      status === "passed"
        ? `Verification stage passed (cycle ${cycle}) — independent quality check`
        : `Verification stage failed (cycle ${cycle}): ${deduped.map((i) => i.message).join("; ")}`,
  });
}

export function appendSdlcStage(
  record: SdlcStageRecord,
  stage: SdlcStageResult,
): SdlcStageRecord {
  return { stages: [...record.stages, stage] };
}

export function validateStageOrder(
  record: SdlcStageRecord,
  cycle: number,
): string | null {
  return assertTestingBeforeVerification(record, cycle);
}

export { parseSdlcStageRecord };
