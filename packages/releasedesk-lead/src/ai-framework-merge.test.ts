import { describe, expect, it } from "vitest";
import {
  createInMemoryStore,
  createTaskRecord,
  mappingForAtlas,
  mappingForOwasp,
  nowIso,
} from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";
import { assessReadiness } from "./readiness.js";
import {
  assertPrMergeAllowedForAiFrameworks,
  evaluatePrAiFrameworkMergeGate,
} from "./pr/ai-framework-merge.js";
import { createMockPrClient, openAndTrackPullRequest } from "./pr/index.js";

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

  it("human waiver clears merge block; Lead records waiver on report", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });
    const report = await lead.startOnDemandCheck({
      goal: "waiver path",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });
    // Inject mapped finding via in-memory reassessment helpers
    const injected = {
      ...report,
      run: {
        ...report.run,
        tasks: [
          ...report.run.tasks.filter((t) => t.agentRole !== "security"),
          securityTaskWithMappedFindings(report.runId),
        ],
      },
    };
    const blocked = assessReadiness({
      tasks: injected.run.tasks,
      approvals: injected.approvals,
      featureSignOffs: injected.featureSignOffs,
      aiFrameworkWaivers: injected.aiFrameworkWaivers,
      prDraft: false,
      prState: "open",
    });
    expect(blocked.aiFrameworkMergeGate.blocksPrMerge).toBe(true);

    const waived = lead.applyAiFrameworkWaiversToReport(injected, [
      {
        findingId: "AI-FW-PROMPT-INJECTION",
        waivedBy: "alice",
        reason: "Compensating control accepted",
      },
    ]);
    expect(waived.aiFrameworkWaivers.waivers).toHaveLength(1);
    expect(waived.assessment.aiFrameworkMergeGate.blocksPrMerge).toBe(false);
  });

  it("openAndTrackPullRequest records draft flag for merge gate", async () => {
    const client = createMockPrClient({ startNumber: 55 });
    const draft = await openAndTrackPullRequest(client, {
      repository: "vishamathur/mvp-releasedesk",
      title: "Draft",
      body: "draft",
      head: "cursor/draft",
      base: "main",
      draft: true,
    });
    expect(draft.draft).toBe(true);
    expect(draft.prNumber).toBe(55);

    const open = await openAndTrackPullRequest(client, {
      repository: "vishamathur/mvp-releasedesk",
      title: "Ready for review",
      body: "open",
      head: "cursor/open",
      base: "main",
      draft: false,
    });
    expect(open.draft).toBe(false);
  });
});
