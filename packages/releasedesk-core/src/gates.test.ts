import { describe, expect, it } from "vitest";
import { createTaskRecord } from "./task.js";
import { createRunId } from "./ids.js";
import {
  MANDATORY_ANALYSIS_ROLES,
  MANDATORY_SECURITY_ROLE,
  SECURITY_TASK_KIND,
  assertMandatoryAnalysisRoles,
  evaluateSecurityParticipation,
  hasRecordedSecurityResult,
  securityParticipationSatisfied,
} from "./gates.js";

const runId = createRunId();

describe("mandatory Security gate contracts", () => {
  it("includes security in mandatory analysis roles (no selective omit)", () => {
    expect(MANDATORY_ANALYSIS_ROLES).toContain(MANDATORY_SECURITY_ROLE);
    expect(MANDATORY_ANALYSIS_ROLES).toEqual([
      "change_analyst",
      "standards",
      "security",
    ]);
    expect(SECURITY_TASK_KIND).toBe("security_review");
    expect(() => assertMandatoryAnalysisRoles([...MANDATORY_ANALYSIS_ROLES])).not.toThrow();
    expect(() =>
      assertMandatoryAnalysisRoles(["change_analyst", "standards"]),
    ).toThrow(/security/);
  });

  it("blocks when Security did not run", () => {
    const tasks = [
      createTaskRecord({
        runId,
        name: "Change analysis",
        agentRole: "change_analyst",
        status: "completed",
      }),
    ];
    const gate = evaluateSecurityParticipation(tasks);
    expect(gate.mandatory).toBe(true);
    expect(gate.satisfied).toBe(false);
    expect(gate.status).toBe("missing");
    expect(gate.blockingIssue).toMatch(/did not run/i);
    expect(securityParticipationSatisfied(tasks)).toBe(false);
  });

  it("blocks when Security completed without a recorded result", () => {
    const task = createTaskRecord({
      runId,
      name: "Security review",
      agentRole: "security",
      status: "completed",
    });
    // completed but empty output/evidence
    const completed = {
      ...task,
      status: "completed" as const,
      completedAt: new Date().toISOString(),
      output: undefined,
      evidence: [],
    };
    expect(hasRecordedSecurityResult(completed)).toBe(false);
    const gate = evaluateSecurityParticipation([completed]);
    expect(gate.status).toBe("no_recorded_result");
    expect(gate.satisfied).toBe(false);
  });

  it("satisfies when Security completed with recorded output", () => {
    const task = createTaskRecord({
      runId,
      name: "Security review",
      agentRole: "security",
      status: "completed",
    });
    const completed = {
      ...task,
      status: "completed" as const,
      completedAt: new Date().toISOString(),
      output: {
        agentRole: "security",
        riskLevel: "none",
        releaseBlockingCount: 0,
        findings: [],
        summary: "Clean",
      },
      evidence: [],
    };
    expect(hasRecordedSecurityResult(completed)).toBe(true);
    const gate = evaluateSecurityParticipation([completed]);
    expect(gate.status).toBe("satisfied");
    expect(gate.satisfied).toBe(true);
    expect(gate.blockingIssue).toBeUndefined();
  });

  it("blocks incomplete or failed Security tasks", () => {
    const incomplete = createTaskRecord({
      runId,
      name: "Security review",
      agentRole: "security",
      status: "running",
    });
    expect(evaluateSecurityParticipation([incomplete]).status).toBe("incomplete");

    const failed = {
      ...createTaskRecord({
        runId,
        name: "Security review",
        agentRole: "security",
        status: "failed",
      }),
      status: "failed" as const,
    };
    expect(evaluateSecurityParticipation([failed]).status).toBe("failed");
  });
});
