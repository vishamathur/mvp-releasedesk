import { describe, expect, it } from "vitest";
import { createInMemoryStore, createTaskRecord, formatMockNote } from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";
import { createMockPrClient } from "./pr/index.js";
import {
  evaluateTestingStage,
  evaluateVerificationStage,
  validateStageOrder,
  appendSdlcStage,
  parseSdlcStageRecord,
} from "./stages.js";
import type { AgentRunner } from "./agent-runner.js";
import { createDefaultStubRunners } from "./stub-runners.js";

const runId = "run_stage_test";

function builderTask(output: Record<string, unknown>) {
  const base = createTaskRecord({
    runId,
    name: "builder",
    agentRole: "builder",
    status: "completed",
  });
  return {
    ...base,
    status: "completed" as const,
    output,
    completedAt: base.updatedAt,
  };
}

describe("evaluateTestingStage / evaluateVerificationStage", () => {
  it("keeps stages distinct and fails Verification when Testing only ran", () => {
    const tasks = [
      builderTask({
        testsPassed: undefined,
        workItems: [
          { kind: "coding", status: "completed", branch: "cursor/x" },
          { kind: "testing", status: "completed", branch: "cursor/x" },
        ],
        proposedBranch: "cursor/x",
        branchMetadata: { autoMerge: false },
      }),
    ];

    const testing = evaluateTestingStage({ tasks, cycle: 1 });
    expect(testing.stage).toBe("testing");
    expect(testing.evidence.testingAgentRan).toBe(true);

    const verification = evaluateVerificationStage({
      tasks,
      testingStage: testing,
      cycle: 1,
    });
    expect(verification.stage).toBe("verification");
    expect(verification.status).toBe("failed");
    expect(
      verification.issues.some(
        (i) =>
          i.message.toLowerCase().includes("no auto-pass") ||
          i.code === "verification_missing_pass" ||
          i.code === "verification_tests_not_passed",
      ),
    ).toBe(true);
    expect(verification.evidence.independentDecision).toBe(true);
  });

  it("passes Verification only with explicit testsPassed=true + coding complete", () => {
    const tasks = [
      builderTask({
        testsPassed: true,
        workItems: [
          { kind: "coding", status: "completed" },
          { kind: "testing", status: "completed" },
        ],
        proposedBranch: "cursor/ok",
        proposedPrUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/1",
        branchMetadata: { autoMerge: false },
      }),
    ];
    const testing = evaluateTestingStage({ tasks, cycle: 1 });
    expect(testing.status).toBe("passed");
    const verification = evaluateVerificationStage({
      tasks,
      testingStage: testing,
      cycle: 1,
    });
    expect(verification.status).toBe("passed");

    let record = parseSdlcStageRecord({ stages: [] });
    record = appendSdlcStage(record, testing);
    record = appendSdlcStage(record, verification);
    expect(validateStageOrder(record, 1)).toBeNull();
  });

  it("does not auto-pass Verification when testsPassed=false even if Testing completed", () => {
    const tasks = [
      builderTask({
        testsPassed: false,
        workItems: [
          { kind: "coding", status: "completed" },
          { kind: "testing", status: "completed" },
        ],
        branchMetadata: { autoMerge: false },
      }),
    ];
    const testing = evaluateTestingStage({ tasks, cycle: 1 });
    expect(testing.status).toBe("failed");
    expect(testing.evidence.testingAgentRan).toBe(true);
    const verification = evaluateVerificationStage({
      tasks,
      testingStage: testing,
      cycle: 1,
    });
    expect(verification.status).toBe("failed");
  });
});

describe("Lead sequences Testing → Verification before checkpoints", () => {
  it("records distinct stages in order during remediation", async () => {
    const store = createInMemoryStore();
    const stubs = createDefaultStubRunners();
    let securityCalls = 0;

    const securityRunner: AgentRunner = async (inv) => {
      securityCalls += 1;
      if (securityCalls === 1) {
        return {
          status: "completed",
          summary: formatMockNote("Blocking finding to force builder"),
          payload: {
            agentRole: "security",
            findings: [
              {
                id: "SEC-1",
                severity: "critical",
                title: "Blocker",
                summary: formatMockNote("force remediation"),
                releaseBlocking: true,
              },
            ],
            releaseBlockingCount: 1,
            riskLevel: "critical",
          },
          mocksUsed: [{ mocked: true as const, mockLabel: "test" }],
        };
      }
      return stubs.security(inv);
    };

    const lead = new LeadOrchestrator({
      store,
      maxRemediationCycles: 1,
      enableRemediation: true,
      prClient: { client: createMockPrClient({ startNumber: 9200 }) },
      runners: { security: securityRunner },
    });

    const report = await lead.startOnDemandCheck({
      goal: "Stage order check",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    const testingIdx = report.sdlcStages.stages.findIndex((s) => s.stage === "testing");
    const verificationIdx = report.sdlcStages.stages.findIndex(
      (s) => s.stage === "verification",
    );
    expect(testingIdx).toBeGreaterThanOrEqual(0);
    expect(verificationIdx).toBeGreaterThan(testingIdx);

    const actions = report.run.auditTrail.map((e) => e.action);
    expect(actions).toContain("sdlc.testing_completed");
    expect(actions).toContain("sdlc.verification_completed");
    expect(actions.indexOf("sdlc.testing_completed")).toBeLessThan(
      actions.indexOf("sdlc.verification_completed"),
    );

    // Checkpoints still run after the distinct stages.
    expect(report.checkpoints.checkpoints.some((c) => c.stage === "cloud_agents")).toBe(
      true,
    );
  });
});
