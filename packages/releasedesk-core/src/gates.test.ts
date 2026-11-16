import { describe, expect, it } from "vitest";
import { createTaskRecord } from "./task.js";
import { createRunId } from "./ids.js";
import {
  AI_RED_TEAMING_ROLE,
  MANDATORY_ANALYSIS_ROLES,
  MANDATORY_SECURITY_ROLE,
  SECURITY_TASK_KIND,
  assertMandatoryAnalysisRoles,
  collectAiRedTeamingBlockingCount,
  evaluateAiRedTeamingHardBlock,
  evaluateSecurityParticipation,
  hasRealtimeAiRedTeamingFlags,
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

describe("AI Red Teaming hard block + realtime flags", () => {
  function completedAiRedTask(opts: {
    passKind: "guardrail" | "post_builder" | "hard_block";
    releaseBlockingCount: number;
    flagLeadRealtime?: boolean;
  }) {
    const task = createTaskRecord({
      runId,
      name: "AI Red Teaming",
      agentRole: "ai_red_teaming",
      status: "completed",
    });
    return {
      ...task,
      status: "completed" as const,
      completedAt: new Date().toISOString(),
      output: {
        agentRole: AI_RED_TEAMING_ROLE,
        passKind: opts.passKind,
        touchpoint: "post_builder",
        releaseBlockingCount: opts.releaseBlockingCount,
        riskLevel: opts.releaseBlockingCount > 0 ? "high" : "none",
        findings: [],
        flagLeadRealtime: opts.flagLeadRealtime ?? opts.releaseBlockingCount > 0,
        hardBlockRecommended: opts.passKind === "hard_block" && opts.releaseBlockingCount > 0,
        summary: "AI Red Teaming pass",
      },
      evidence: [],
    };
  }

  it("clears hard block when no release-blocking findings", () => {
    const gate = evaluateAiRedTeamingHardBlock({
      tasks: [completedAiRedTask({ passKind: "hard_block", releaseBlockingCount: 0 })],
      prDraft: false,
      reviewReady: true,
    });
    expect(gate.label).toBe("AI Red Teaming");
    expect(gate.status).toBe("clear");
    expect(gate.blocked).toBe(false);
  });

  it("hard-blocks review-ready PRs with ATLAS/OWASP findings", () => {
    const gate = evaluateAiRedTeamingHardBlock({
      tasks: [completedAiRedTask({ passKind: "post_builder", releaseBlockingCount: 2 })],
      prDraft: false,
      reviewReady: true,
    });
    expect(gate.status).toBe("blocked");
    expect(gate.blocked).toBe(true);
    expect(gate.blockingIssue).toMatch(/AI Red Teaming/);
    expect(gate.frameworks).toEqual(["mitre_atlas", "owasp_llm"]);
  });

  it("exempts draft PRs from hard block", () => {
    const gate = evaluateAiRedTeamingHardBlock({
      tasks: [completedAiRedTask({ passKind: "hard_block", releaseBlockingCount: 3 })],
      prDraft: true,
      reviewReady: false,
    });
    expect(gate.status).toBe("exempt_draft");
    expect(gate.blocked).toBe(false);
    expect(gate.draftExempt).toBe(true);
  });

  it("detects realtime Lead flags from AI Red Teaming passes", () => {
    const tasks = [
      completedAiRedTask({
        passKind: "guardrail",
        releaseBlockingCount: 1,
        flagLeadRealtime: true,
      }),
    ];
    expect(hasRealtimeAiRedTeamingFlags(tasks)).toBe(true);
    expect(collectAiRedTeamingBlockingCount(tasks)).toBe(1);
  });
});
