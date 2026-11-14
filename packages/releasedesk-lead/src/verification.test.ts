import { describe, expect, it } from "vitest";
import { createTaskRecord, createRunId } from "@releasedesk/core";
import {
  checkpointNeedsRemediation,
  evaluateCheckpoint,
  parseCheckpointRecord,
} from "./verification.js";

const runId = createRunId();

function task(
  role: "change_analyst" | "standards" | "security" | "builder",
  output: Record<string, unknown>,
  status: "completed" | "failed" = "completed",
) {
  const base = createTaskRecord({
    runId,
    name: role,
    agentRole: role,
    status,
  });
  return {
    ...base,
    status,
    output,
    completedAt: status === "completed" ? base.updatedAt : undefined,
  };
}

describe("evaluateCheckpoint", () => {
  it("passes specialist_analysis when specialists are clean", () => {
    const result = evaluateCheckpoint({
      stage: "specialist_analysis",
      tasks: [
        task("change_analyst", { overallImpact: "low", summary: "ok" }),
        task("standards", { compliant: true, deviations: [] }),
        task("security", { releaseBlockingCount: 0, riskLevel: "none" }),
      ],
    });
    expect(result.status).toBe("passed");
    expect(checkpointNeedsRemediation(result)).toBe(false);
  });

  it("fails specialist_analysis on blocking security findings", () => {
    const result = evaluateCheckpoint({
      stage: "specialist_analysis",
      tasks: [
        task("change_analyst", { overallImpact: "low" }),
        task("standards", { compliant: true, deviations: [] }),
        task("security", { releaseBlockingCount: 2, riskLevel: "critical" }),
      ],
    });
    expect(result.status).toBe("failed");
    expect(checkpointNeedsRemediation(result)).toBe(true);
    expect(result.issues.some((i) => i.code === "blocking_finding")).toBe(true);
  });

  it("fails cloud_agents when testsPassed=false", () => {
    const result = evaluateCheckpoint({
      stage: "cloud_agents",
      cycle: 1,
      tasks: [
        task("builder", {
          testsPassed: false,
          proposedPrUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/1",
          workItems: [{ kind: "testing", status: "completed" }],
          branchMetadata: { autoMerge: false },
        }),
      ],
    });
    expect(result.status).toBe("failed");
    expect(result.issues.some((i) => i.code === "tests_failed")).toBe(true);
    expect(result.evidence.testsPassed).toBe(false);
  });

  it("passes post_remediation when reverify is clean and tests pass", () => {
    const result = evaluateCheckpoint({
      stage: "post_remediation",
      cycle: 1,
      tasks: [
        task("standards", { compliant: true, deviations: [] }),
        task("security", { releaseBlockingCount: 0, riskLevel: "none" }),
        task("builder", {
          testsPassed: true,
          proposedPrUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/2",
          workItems: [
            { kind: "coding", status: "completed" },
            { kind: "testing", status: "completed" },
          ],
          branchMetadata: { autoMerge: false },
        }),
      ],
    });
    expect(result.status).toBe("passed");
  });

  it("rejects autoMerge=true on cloud checkpoint", () => {
    const result = evaluateCheckpoint({
      stage: "cloud_agents",
      tasks: [
        task("builder", {
          testsPassed: true,
          workItems: [],
          branchMetadata: { autoMerge: true },
        }),
      ],
    });
    expect(result.status).toBe("failed");
    expect(result.issues.some((i) => i.code === "auto_merge_forbidden")).toBe(true);
    expect(checkpointNeedsRemediation(result)).toBe(false);
  });
});

describe("parseCheckpointRecord", () => {
  it("returns empty for invalid input", () => {
    expect(parseCheckpointRecord(undefined).checkpoints).toEqual([]);
    expect(parseCheckpointRecord({}).checkpoints).toEqual([]);
  });
});
