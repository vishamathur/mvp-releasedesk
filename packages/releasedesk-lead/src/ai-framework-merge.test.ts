import { describe, expect, it } from "vitest";
import {
  createAiFrameworkWaiver,
  createTaskRecord,
  mappingForAtlas,
  mappingForOwasp,
  nowIso,
} from "@releasedesk/core";
import { assessReadiness } from "./readiness.js";
import {
  assertPrMergeAllowedForAiFrameworks,
  evaluatePrAiFrameworkMergeGate,
} from "./pr/ai-framework-merge.js";

function securityTaskWithMappedFindings(runId: string) {
  const task = createTaskRecord({
    runId,
    name: "Security review",
    agentRole: "security",
    status: "completed",
  });
  return {
    ...task,
    status: "completed" as const,
    completedAt: nowIso(),
    output: {
      agentRole: "security",
      summary: "ATLAS/OWASP hard fails",
      riskLevel: "high",
      releaseBlockingCount: 1,
      frameworkHardFailCount: 1,
      securityCheckFailed: true,
      frameworksApplied: ["mitre_atlas", "owasp_llm_top_10"],
      findings: [
        {
          id: "AI-FW-PROMPT-INJECTION",
          severity: "high",
          title: "Prompt injection",
          summary: "Hard fail",
          releaseBlocking: true,
          hardFail: true,
          frameworkMappings: [mappingForOwasp("LLM01"), mappingForAtlas("AML.T0051")],
        },
      ],
    },
    evidence: [
      {
        id: "ev_test",
        kind: "finding" as const,
        title: "mapped",
        summary: "MOCK: mapped",
        source: "security",
        createdAt: nowIso(),
      },
    ],
  };
}

describe("ATLAS/OWASP PR merge gate", () => {
  it("blocks open-for-review PR merge when findings unresolved", () => {
    const tasks = [securityTaskWithMappedFindings("run_x")];
    const gate = evaluatePrAiFrameworkMergeGate({
      tasks,
      prDraft: false,
      prState: "open",
    });
    expect(gate.blocksPrMerge).toBe(true);
    expect(() =>
      assertPrMergeAllowedForAiFrameworks({ tasks, prDraft: false, prState: "open" }),
    ).toThrow(/ATLAS|OWASP|block/i);
  });

  it("does not block draft PR merge by ATLAS/OWASP findings", () => {
    const tasks = [securityTaskWithMappedFindings("run_y")];
    const gate = evaluatePrAiFrameworkMergeGate({
      tasks,
      prDraft: true,
      prState: "open",
    });
    expect(gate.hasUnresolvedFindings).toBe(true);
    expect(gate.blocksPrMerge).toBe(false);
    expect(() =>
      assertPrMergeAllowedForAiFrameworks({ tasks, prDraft: true, prState: "open" }),
    ).not.toThrow();
  });

  it("readiness is not_ready with unresolved ATLAS/OWASP findings", () => {
    const tasks = [securityTaskWithMappedFindings("run_z")];
    const open = assessReadiness({ tasks, prDraft: false, prState: "open" });
    expect(open.readiness).toBe("not_ready");
    expect(open.aiFrameworkMergeGate.blocksPrMerge).toBe(true);
    expect(open.blockingIssues.some((b) => /ATLAS|OWASP/i.test(b))).toBe(true);

    const draft = assessReadiness({ tasks, prDraft: true, prState: "open" });
    expect(draft.readiness).toBe("not_ready"); // Security still failed
    expect(draft.aiFrameworkMergeGate.blocksPrMerge).toBe(false); // draft exempt from merge block
  });

  it("a recorded human waiver clears the merge block", () => {
    const tasks = [securityTaskWithMappedFindings("run_w")];
    const blocked = assessReadiness({ tasks, prDraft: false, prState: "open" });
    expect(blocked.aiFrameworkMergeGate.blocksPrMerge).toBe(true);
    const waived = assessReadiness({
      tasks,
      prDraft: false,
      prState: "open",
      aiFrameworkWaivers: {
        waivers: [
          createAiFrameworkWaiver({
            findingId: "AI-FW-PROMPT-INJECTION",
            waivedBy: "alice",
            reason: "Compensating control accepted",
            frameworks: ["mitre_atlas", "owasp_llm_top_10"],
          }),
        ],
      },
    });
    expect(waived.aiFrameworkMergeGate.blocksPrMerge).toBe(false);
  });
});
