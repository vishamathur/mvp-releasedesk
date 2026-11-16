import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator, createMockPrClient } from "@releasedesk/lead";
import { DEMO_SCENARIOS, runnersForScenario } from "./scenarios";
import { viewReport } from "./desk";
import type { DeskReport } from "./types";

describe("demo scenarios", () => {
  it("lists the demo scenarios including iteration approval gate", () => {
    expect(DEMO_SCENARIOS.map((s) => s.id).sort()).toEqual(
      [
        "blocked-on-security",
        "happy-path",
        "iteration-approval-gate",
        "pending-approval",
        "remediation-loop",
      ].sort(),
    );
  });

  it("happy-path ends needs_human with pending gates", async () => {
    const cfg = runnersForScenario("happy-path");
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      runners: cfg.runners,
      enableRemediation: cfg.enableRemediation,
      maxRemediationCycles: cfg.maxRemediationCycles,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(report.approvals.gates.every((g) => g.status === "pending")).toBe(true);
    expect(report.run.tasks.some((t) => t.agentRole === "builder")).toBe(false);
  });

  it("remediation-loop records builder + reverify from orchestrator", async () => {
    const cfg = runnersForScenario("remediation-loop");
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      runners: cfg.runners,
      enableRemediation: cfg.enableRemediation,
      maxRemediationCycles: cfg.maxRemediationCycles,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    expect(report.run.tasks.some((t) => t.agentRole === "builder")).toBe(true);
    expect(report.run.tasks.some((t) => t.name.includes("Reverify"))).toBe(true);
    expect(report.checkpoints.checkpoints.length).toBeGreaterThan(1);
    expect(report.featureSignOffs.checklists.length).toBeGreaterThanOrEqual(1);
    expect(report.leadOutput.readiness).toBe("needs_human");
  });

  it("blocked-on-security keeps security blockers (pending gates → needs_human)", async () => {
    const cfg = runnersForScenario("blocked-on-security");
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      runners: cfg.runners,
      enableRemediation: cfg.enableRemediation,
      maxRemediationCycles: cfg.maxRemediationCycles,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    expect(report.leadOutput.blockingIssues.some((b) => b.startsWith("Security:"))).toBe(true);
    expect(report.leadOutput.readiness).toBe("needs_human");
    const release = report.approvals.gates.find((g) => g.kind === "release")!;
    const rejected = lead.applyApprovalsToReport(report, [
      { gateId: release.id, decision: "rejected", decidedBy: "dm", notes: "Security hold" },
    ]);
    expect(rejected.leadOutput.readiness).toBe("not_ready");
  });

  it("viewReport applies approval overlay without mutating original gates", async () => {
    const cfg = runnersForScenario("pending-approval");
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      runners: cfg.runners,
      enableRemediation: false,
      maxRemediationCycles: 0,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const release = report.approvals.gates.find((g) => g.kind === "release")!;
    const merge = report.approvals.gates.find((g) => g.kind === "merge")!;
    const approved = lead.applyApprovalsToReport(report, [
      { gateId: release.id, decision: "approved", decidedBy: "dm" },
      { gateId: merge.id, decision: "approved", decidedBy: "dm" },
    ]);
    const desk: DeskReport = {
      runId: report.runId,
      createdAt: report.run.createdAt,
      updatedAt: report.run.updatedAt,
      prClientMode: "mock",
      autoMerge: false,
      report,
      dmSession: report.dmSession,
      approvalOverlay: approved.approvals,
    };
    const view = viewReport(desk);
    expect(view.leadOutput.readiness).toBe("ready");
    expect(desk.report.approvals.gates.every((g) => g.status === "pending")).toBe(true);
  });

  it("remediation-loop: partial feature sign-off blocks; full sign-off then gates can ready", async () => {
    const cfg = runnersForScenario("remediation-loop");
    const lead = new LeadOrchestrator({
      store: createInMemoryStore(),
      runners: cfg.runners,
      enableRemediation: cfg.enableRemediation,
      maxRemediationCycles: cfg.maxRemediationCycles,
      prClient: { client: createMockPrClient() },
    });
    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const checklist = report.featureSignOffs.checklists[0]!;
    expect(checklist).toBeTruthy();

    const release = report.approvals.gates.find((g) => g.kind === "release")!;
    const merge = report.approvals.gates.find((g) => g.kind === "merge")!;
    const gatesApproved = lead.applyApprovalsToReport(report, [
      { gateId: release.id, decision: "approved", decidedBy: "dm" },
      { gateId: merge.id, decision: "approved", decidedBy: "dm" },
    ]);
    expect(gatesApproved.leadOutput.readiness).toBe("needs_human");

    const partial = lead.applyFeatureSignOffsToReport(gatesApproved, [
      { checklistId: checklist.id, itemId: "intent_match", signedOffBy: "dev" },
    ]);
    expect(partial.leadOutput.readiness).toBe("needs_human");

    const full = lead.applyFeatureSignOffsToReport(gatesApproved, [
      { checklistId: checklist.id, signOffAll: true, signedOffBy: "dev" },
    ]);
    expect(full.leadOutput.readiness).toBe("ready");
  });
});
