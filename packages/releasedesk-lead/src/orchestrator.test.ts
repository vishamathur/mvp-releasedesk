import { describe, expect, it } from "vitest";
import {
  createInMemoryStore,
  formatMockNote,
  nowIso,
  type CreateEvidenceInput,
} from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";
import { createFlakyRunner, createDefaultStubRunners } from "./stub-runners.js";
import type { AgentRunner } from "./agent-runner.js";
import { assessReadiness } from "./readiness.js";
import { allReleaseGatesApproved, getPendingGates } from "./approval.js";

describe("LeadOrchestrator", () => {
  it("create-run → delegate → collect → readiness report (happy path)", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });

    const report = await lead.startOnDemandCheck({
      goal: "Release readiness for Northwind KYC",
      target: {
        repository: "vishamathur/mvp-releasedesk",
        baseRef: "main",
        headRef: "HEAD",
      },
      trigger: { requestedBy: "test" },
    });

    expect(report.runId).toMatch(/^run_/);
    expect(report.run.status).toBe("completed");
    expect(report.leadOutput.agentRole).toBe("lead");
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(report.delegations.length).toBeGreaterThanOrEqual(3);

    const roles = new Set(report.delegations.map((d) => d.agentRole));
    expect(roles.has("change_analyst")).toBe(true);
    expect(roles.has("standards")).toBe(true);
    expect(roles.has("security")).toBe(true);

    const specialistTasks = report.run.tasks.filter((t) => t.agentRole !== "lead");
    expect(specialistTasks.every((t) => t.status === "completed")).toBe(true);
    expect(specialistTasks.some((t) => t.evidence.length > 0)).toBe(true);

    // Explicit statuses + audit trail
    const actions = new Set(report.run.auditTrail.map((e) => e.action));
    expect(actions.has("run.created")).toBe(true);
    expect(actions.has("task.created")).toBe(true);
    expect(actions.has("task.started")).toBe(true);
    expect(actions.has("agent.invoked")).toBe(true);
    expect(actions.has("task.completed")).toBe(true);
    expect(actions.has("human.approval_requested")).toBe(true);
    expect(actions.has("run.completed")).toBe(true);

    // Approvals pending (not auto-approved)
    expect(getPendingGates(report.approvals).length).toBe(2);
    expect(allReleaseGatesApproved(report.approvals)).toBe(false);

    // MOCK labeling present on stub evidence
    const mockEvidence = specialistTasks.flatMap((t) => t.evidence).filter((e) => e.mock?.mocked);
    expect(mockEvidence.length).toBeGreaterThan(0);
    expect(mockEvidence[0]!.summary.startsWith("MOCK:") || mockEvidence[0]!.mock?.note?.startsWith("MOCK:")).toBe(
      true,
    );
  });

  it("runs analysis specialists in parallel (overlapping execution)", async () => {
    const store = createInMemoryStore();
    const startedAt: number[] = [];
    const wrap =
      (inner: AgentRunner): AgentRunner =>
      async (inv) => {
        startedAt.push(Date.now());
        await new Promise((r) => setTimeout(r, 40));
        return inner(inv);
      };

    const stubs = createDefaultStubRunners();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      runners: {
        change_analyst: wrap(stubs.change_analyst),
        standards: wrap(stubs.standards),
        security: wrap(stubs.security),
      },
    });

    const t0 = Date.now();
    await lead.startOnDemandCheck({
      goal: "Parallel dispatch check",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
    });
    const elapsed = Date.now() - t0;

    // Three 40ms tasks sequentially would be ≥120ms; parallel should be closer to one wave.
    expect(startedAt.length).toBe(3);
    const spread = Math.max(...startedAt) - Math.min(...startedAt);
    expect(spread).toBeLessThan(40);
    expect(elapsed).toBeLessThan(150);
  });

  it("retries retryable specialist failures then completes", async () => {
    const store = createInMemoryStore();
    const flaky = createFlakyRunner({ failAttempts: 1, retryable: true });
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      defaultMaxAttempts: 3,
      runners: { security: flaky },
    });

    const report = await lead.startOnDemandCheck({
      goal: "Retry path",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    const security = report.run.tasks.filter((t) => t.agentRole === "security");
    expect(security.some((t) => t.status === "completed")).toBe(true);
    const actions = report.run.auditTrail.map((e) => e.action);
    expect(actions).toContain("task.retrying");
  });

  it("orchestrates remediation + reverification when findings recommend it", async () => {
    const store = createInMemoryStore();
    const blockingSecurity: AgentRunner = async (inv) => {
      const evidence: CreateEvidenceInput[] = [
        {
          kind: "advisory",
          title: "Blocking finding",
          summary: formatMockNote("Injected release-blocking finding"),
          source: "security",
          mock: { mocked: true, mockLabel: "test-security", note: formatMockNote("fixture") },
        },
      ];
      return {
        status: "completed",
        summary: formatMockNote("Security found blocking issue"),
        payload: {
          agentRole: "security",
          findings: [
            {
              id: "SEC-1",
              severity: "critical",
              title: "Fixture CVE",
              summary: formatMockNote("Blocking"),
              releaseBlocking: true,
            },
          ],
          releaseBlockingCount: 1,
          riskLevel: "critical",
        },
        evidence,
        mocksUsed: [{ mocked: true, mockLabel: "test-security" }],
      };
    };

    // First security call blocks; reverify calls succeed clean.
    let securityCalls = 0;
    const stubs = createDefaultStubRunners();
    const securityRunner: AgentRunner = async (inv) => {
      securityCalls += 1;
      if (securityCalls === 1) return blockingSecurity(inv);
      return stubs.security(inv);
    };

    const lead = new LeadOrchestrator({
      store,
      maxRemediationCycles: 1,
      enableRemediation: true,
      runners: { security: securityRunner },
    });

    const report = await lead.startOnDemandCheck({
      goal: "Remediation loop",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    const builderTasks = report.run.tasks.filter((t) => t.agentRole === "builder");
    expect(builderTasks.length).toBeGreaterThanOrEqual(1);
    expect(builderTasks[0]!.status).toBe("completed");

    const reverify = report.run.tasks.filter((t) => t.name.includes("Reverify"));
    expect(reverify.length).toBeGreaterThanOrEqual(2);
    expect(reverify.every((t) => t.status === "completed")).toBe(true);
    // Initial wave had a blocking security finding; reverify should clear latest readiness blockers.
    const firstSecurity = report.run.tasks.find(
      (t) => t.agentRole === "security" && t.name === "Security review",
    );
    expect(firstSecurity?.output?.releaseBlockingCount).toBe(1);
    expect(report.assessment.blockingIssues.some((b) => b.startsWith("Security:"))).toBe(false);
    expect(securityCalls).toBeGreaterThanOrEqual(2);
  });

  it("models human approval gates and upgrades readiness after approve", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });
    const report = await lead.startOnDemandCheck({
      goal: "Approval gate",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    expect(report.leadOutput.readiness).toBe("needs_human");

    const releaseGate = report.approvals.gates.find((g) => g.kind === "release")!;
    const mergeGate = report.approvals.gates.find((g) => g.kind === "merge")!;

    const approved = lead.applyApprovalsToReport(report, [
      { gateId: releaseGate.id, decision: "approved", decidedBy: "dm@northwind" },
      { gateId: mergeGate.id, decision: "approved", decidedBy: "dm@northwind" },
    ]);

    expect(approved.leadOutput.readiness).toBe("ready");
    expect(allReleaseGatesApproved(approved.approvals)).toBe(true);

    const rejected = lead.applyApprovalsToReport(report, [
      { gateId: releaseGate.id, decision: "rejected", decidedBy: "dm@northwind", notes: "Hold" },
    ]);
    expect(rejected.assessment.blockingIssues.some((b) => b.includes("rejected"))).toBe(true);
    expect(rejected.leadOutput.readiness).toBe("not_ready");
  });

  it("supports scheduled trigger metadata and DM text / MOCK voice", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });
    lead.handleDmText("Please run tonight's release check");
    lead.handleDmVoice("start release check");

    const report = await lead.startScheduledCheck({
      goal: "Scheduled nightly check",
      target: { repository: "vishamathur/mvp-releasedesk" },
      trigger: { requestedBy: "scheduler" },
    });

    expect(report.run.metadata.trigger).toMatchObject({ kind: "scheduled" });
    const session = lead.getDmSession();
    expect(session.messages.some((m) => m.channel === "text" && m.role === "dm")).toBe(true);
    expect(session.messages.some((m) => m.channel === "voice" && m.mock === true)).toBe(true);
    expect(session.messages.some((m) => m.channel === "voice" && m.text.startsWith("MOCK:"))).toBe(
      true,
    );
  });

  it("records independent results through injectable runners (not hardcoded conversation)", async () => {
    const store = createInMemoryStore();
    const custom: AgentRunner = async (inv) => ({
      status: "completed",
      summary: `custom-${inv.agentRole}-${inv.taskId}`,
      payload: {
        agentRole: inv.agentRole,
        ...(inv.agentRole === "change_analyst"
          ? {
              releaseNotesDraft: "custom notes",
              findings: [],
              overallImpact: "low",
              commitsReviewed: 3,
            }
          : inv.agentRole === "standards"
            ? { compliant: true, deviations: [], policiesChecked: ["p1"] }
            : inv.agentRole === "security"
              ? { findings: [], releaseBlockingCount: 0, riskLevel: "none" }
              : { workItems: [] }),
      },
      evidence: [
        {
          kind: "log",
          title: `Custom ${inv.agentRole}`,
          summary: `Independent result for ${inv.taskId}`,
          source: inv.agentRole,
        },
      ],
    });

    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      runners: {
        change_analyst: custom,
        standards: custom,
        security: custom,
      },
    });

    const report = await lead.startOnDemandCheck({
      goal: "Injectable runners",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    for (const role of ["change_analyst", "standards", "security"] as const) {
      const task = report.run.tasks.find((t) => t.agentRole === role)!;
      expect(task.output?.summary).toBe(`custom-${role}-${task.id}`);
      expect(task.evidence[0]?.title).toBe(`Custom ${role}`);
    }
  });
});

describe("assessReadiness", () => {
  it("returns unknown with no specialist tasks", () => {
    const result = assessReadiness({ tasks: [] });
    expect(result.readiness).toBe("unknown");
  });
});

describe("recordHumanApproval on live run", () => {
  it("records approval before run completion", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });

    // Drive a partial path: create check is atomic; use requestApproval on a fresh run.
    const run = await store.create({
      goal: "manual",
      target: { repository: "vishamathur/mvp-releasedesk" },
      metadata: { approvals: { gates: [] } },
    });
    const gate = await lead.requestApproval(run.runId, "release", "test");
    const { gate: decided, assessment } = await lead.recordHumanApproval(
      run.runId,
      gate.id,
      "approved",
      { decidedBy: "tester" },
    );
    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).toBe("tester");
    expect(assessment).toBeDefined();

    const events = (await store.get(run.runId))!.auditTrail.map((e) => e.action);
    expect(events).toContain("human.approval_requested");
    expect(events).toContain("human.approval_recorded");
    // silence unused
    expect(nowIso()).toBeTruthy();
  });
});
