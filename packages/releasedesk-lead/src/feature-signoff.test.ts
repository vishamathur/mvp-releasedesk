import { describe, expect, it } from "vitest";
import {
  createInMemoryStore,
  formatMockNote,
  type TaskRecord,
} from "@releasedesk/core";
import {
  allReleaseGatesApproved,
  getPendingGates,
} from "./approval.js";
import {
  createChecklistsForFeatures,
  detectNewFeaturesFromTasks,
  getIncompleteChecklists,
} from "./feature-signoff.js";
import { LeadOrchestrator } from "./orchestrator.js";
import type { AgentRunner } from "./agent-runner.js";
import { createDefaultStubRunners } from "./stub-runners.js";
import { createMockPrClient } from "./pr/index.js";

describe("feature detection from Builder / coding work", () => {
  it("detects features from completed coding work items", () => {
    const task = {
      id: "task_b1",
      runId: "run_1",
      name: "Builder",
      agentRole: "builder",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
      dependsOn: [],
      evidence: [],
      retry: { attempt: 1, maxAttempts: 2 },
      output: {
        workItems: [
          {
            kind: "coding",
            status: "completed",
            branch: "cursor/ai-feature-1",
            prUrl: "https://github.com/org/repo/pull/1",
            notes: "Added KYC retention labels",
          },
          { kind: "testing", status: "completed", branch: "cursor/ai-feature-1" },
        ],
      },
    } as TaskRecord;
    const features = detectNewFeaturesFromTasks([task]);
    expect(features).toHaveLength(1);
    expect(features[0]!.branch).toBe("cursor/ai-feature-1");
    expect(features[0]!.sourceAgent).toBe("coding");
    const checklists = createChecklistsForFeatures(features);
    expect(checklists[0]!.kind).toBe("feature_review");
    expect(checklists[0]!.status).toBe("pending");
    expect(getIncompleteChecklists({ checklists })).toHaveLength(1);
  });
});

describe("feature checklist sign-off readiness", () => {
  it("incomplete checklist blocks; partial still blocks; full sign-off then merge/release can ready", async () => {
    const stubs = createDefaultStubRunners();
    let securityCalls = 0;
    const security: AgentRunner = async (inv) => {
      securityCalls += 1;
      if (securityCalls === 1) {
        return {
          status: "completed",
          summary: formatMockNote("Blocking security"),
          payload: {
            agentRole: "security",
            findings: [
              {
                id: "SEC-1",
                title: "Issue",
                severity: "critical",
                releaseBlocking: true,
                component: "apps/kyc",
                summary: formatMockNote("block"),
              },
            ],
            releaseBlockingCount: 1,
            riskLevel: "critical",
          },
          evidence: [],
          mocksUsed: [],
        };
      }
      return stubs.security(inv);
    };

    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      enableRemediation: true,
      maxRemediationCycles: 2,
      runners: { security },
      prClient: { client: createMockPrClient({ startNumber: 900 }) },
    });

    const report = await lead.startOnDemandCheck({
      goal: "Feature checklist gate",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    expect(report.run.tasks.some((t) => t.agentRole === "builder")).toBe(true);
    expect(report.featureSignOffs.checklists.length).toBeGreaterThanOrEqual(1);
    expect(
      report.featureSignOffs.checklists.every((c) => c.status === "pending"),
    ).toBe(true);
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(
      report.leadOutput.blockingIssues.some((b) => b.includes("Feature sign-off")),
    ).toBe(true);

    // Merge/release alone cannot clear readiness while checklist incomplete.
    const release = report.approvals.gates.find((g) => g.kind === "release")!;
    const merge = report.approvals.gates.find((g) => g.kind === "merge")!;
    const approvedGatesOnly = lead.applyApprovalsToReport(report, [
      { gateId: release.id, decision: "approved", decidedBy: "dm@northwind" },
      { gateId: merge.id, decision: "approved", decidedBy: "dm@northwind" },
    ]);
    expect(approvedGatesOnly.leadOutput.readiness).toBe("needs_human");
    expect(allReleaseGatesApproved(approvedGatesOnly.approvals)).toBe(true);

    // Partial checklist sign-off still blocks.
    const checklist = report.featureSignOffs.checklists[0]!;
    const partial = lead.applyFeatureSignOffsToReport(approvedGatesOnly, [
      {
        checklistId: checklist.id,
        itemId: "intent_match",
        signedOffBy: "dev@northwind",
      },
      {
        checklistId: checklist.id,
        itemId: "manual_code_review",
        signedOffBy: "dev@northwind",
      },
    ]);
    expect(partial.featureSignOffs.checklists[0]!.status).toBe("in_progress");
    expect(partial.leadOutput.readiness).toBe("needs_human");
    expect(
      partial.leadOutput.blockingIssues.some((b) => b.includes("Feature sign-off")),
    ).toBe(true);

    // Full checklist sign-off + already-approved merge/release → ready.
    const fullySigned = lead.applyFeatureSignOffsToReport(approvedGatesOnly, [
      {
        checklistId: checklist.id,
        signOffAll: true,
        signedOffBy: "dev@northwind",
        notes: "Verified AI-produced code item-by-item",
      },
    ]);
    expect(fullySigned.featureSignOffs.checklists.every((c) => c.status === "completed")).toBe(
      true,
    );
    expect(getIncompleteChecklists(fullySigned.featureSignOffs)).toHaveLength(0);
    expect(fullySigned.leadOutput.readiness).toBe("ready");

    // Audit recorded request during the run (never auto-completed).
    const actions = report.run.auditTrail.map((e) => e.action);
    expect(actions).toContain("feature.detected");
    expect(actions).toContain("feature.signoff_requested");
    expect(actions).not.toContain("feature.signoff_completed");
    expect(getPendingGates(report.approvals).length).toBe(2);
  });

  it("happy path without Builder has no feature checklists; merge/release still gate readiness", async () => {
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      enableRemediation: false,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: "No features",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });
    expect(report.featureSignOffs.checklists).toEqual([]);
    expect(report.leadOutput.readiness).toBe("needs_human");
    const release = report.approvals.gates.find((g) => g.kind === "release")!;
    const merge = report.approvals.gates.find((g) => g.kind === "merge")!;
    const approved = lead.applyApprovalsToReport(report, [
      { gateId: release.id, decision: "approved", decidedBy: "dm" },
      { gateId: merge.id, decision: "approved", decidedBy: "dm" },
    ]);
    expect(approved.leadOutput.readiness).toBe("ready");
  });
});
