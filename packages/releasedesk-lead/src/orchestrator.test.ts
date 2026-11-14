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
import { createMockPrClient } from "./pr/index.js";

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

describe("Milestone 6 — verification loops + PR workflow", () => {
  it("fail checkpoint → remediate → pass → pending human approval", async () => {
    const store = createInMemoryStore();
    const stubs = createDefaultStubRunners();
    let securityCalls = 0;
    let builderCalls = 0;

    const securityRunner: AgentRunner = async (inv) => {
      securityCalls += 1;
      if (securityCalls === 1) {
        return {
          status: "completed",
          summary: formatMockNote("Blocking security finding"),
          payload: {
            agentRole: "security",
            findings: [
              {
                id: "SEC-BLOCK",
                severity: "critical",
                title: "Fixture CVE",
                summary: formatMockNote("Blocks release"),
                releaseBlocking: true,
              },
            ],
            releaseBlockingCount: 1,
            riskLevel: "critical",
          },
          evidence: [
            {
              kind: "advisory",
              title: "Blocking",
              summary: formatMockNote("Injected blocker"),
              source: "security",
              mock: { mocked: true as const, mockLabel: "test-security" },
            },
          ],
          mocksUsed: [{ mocked: true as const, mockLabel: "test-security" }],
        };
      }
      return stubs.security(inv);
    };

    const builderRunner: AgentRunner = async (inv) => {
      builderCalls += 1;
      // First builder cycle: tests fail → cloud checkpoint fails → another loop.
      if (builderCalls === 1) {
        return {
          status: "completed",
          summary: formatMockNote("Builder cycle 1 — tests failed"),
          payload: {
            agentRole: "builder",
            workItems: [
              { kind: "coding", status: "completed", branch: "MOCK:fix-c1" },
              { kind: "testing", status: "completed", branch: "MOCK:fix-c1" },
            ],
            proposedBranch: "MOCK:fix-c1",
            proposedPrUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/8101",
            testsPassed: false,
            branchMetadata: {
              proposedBranch: "MOCK:fix-c1",
              baseBranch: "main",
              testsPassed: false,
              prUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/8101",
              autoMerge: false,
              humanMergeGateRequired: true,
            },
          },
          evidence: [
            {
              kind: "pr_ref",
              title: "PR c1",
              summary: formatMockNote("tests failed"),
              source: "builder",
              uri: "https://github.com/vishamathur/mvp-releasedesk/pull/8101",
            },
          ],
          mocksUsed: [{ mocked: true as const, mockLabel: "builder-test" }],
        };
      }
      return stubs.builder(inv);
    };

    const lead = new LeadOrchestrator({
      store,
      maxRemediationCycles: 2,
      enableRemediation: true,
      prClient: { client: createMockPrClient({ startNumber: 8101 }) },
      runners: { security: securityRunner, builder: builderRunner },
    });

    const report = await lead.startOnDemandCheck({
      goal: "M6 verification loop",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    // Specialist analysis checkpoint failed, then remediation cycles ran.
    const stages = report.checkpoints.checkpoints.map((c) => `${c.stage}:${c.status}`);
    expect(stages[0]).toBe("specialist_analysis:failed");
    expect(report.checkpoints.checkpoints.some((c) => c.stage === "cloud_agents")).toBe(true);
    expect(
      report.checkpoints.checkpoints.some(
        (c) => c.stage === "post_remediation" && c.status === "passed",
      ),
    ).toBe(true);

    expect(builderCalls).toBeGreaterThanOrEqual(2);
    expect(securityCalls).toBeGreaterThanOrEqual(2);

    // PR tracked / polled; never auto-merged.
    expect(report.pullRequests.pullRequests.length).toBeGreaterThanOrEqual(1);
    expect(report.pullRequests.pullRequests.every((p) => p.autoMerge === false)).toBe(true);
    expect(
      report.pullRequests.pullRequests.every((p) => p.humanMergeGateRequired === true),
    ).toBe(true);

    // Human gates pending — not auto-approved.
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(getPendingGates(report.approvals).length).toBe(2);

    const actions = report.run.auditTrail.map((e) => e.action);
    expect(actions).toContain("checkpoint.failed");
    expect(actions).toContain("checkpoint.passed");
    expect(actions).toContain("remediation.cycle_started");
    expect(actions).toContain("pr.tracked");
    expect(actions).toContain("pr.status_polled");
    expect(actions).toContain("pr.merge_blocked");
    expect(actions).toContain("human.approval_requested");
    expect(actions).not.toContain("human.approval_recorded");
  });

  it("rejection path yields not_ready with audit-friendly report", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      prClient: { mode: "mock" },
    });
    const report = await lead.startOnDemandCheck({
      goal: "Rejection path",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    expect(report.checkpoints.checkpoints.some((c) => c.stage === "specialist_analysis")).toBe(
      true,
    );
    expect(report.leadOutput.readiness).toBe("needs_human");

    const releaseGate = report.approvals.gates.find((g) => g.kind === "release")!;
    const rejected = lead.applyApprovalsToReport(report, [
      {
        gateId: releaseGate.id,
        decision: "rejected",
        decidedBy: "dm@northwind",
        notes: "Hold release",
      },
    ]);
    expect(rejected.leadOutput.readiness).toBe("not_ready");
    expect(rejected.assessment.blockingIssues.some((b) => b.includes("rejected"))).toBe(true);
  });

  it("records audit events for checkpoints, PR workflow, and approvals", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: true,
      maxRemediationCycles: 1,
      prClient: { client: createMockPrClient() },
    });

    // Force remediation via blocking standards on first pass only.
    const stubs = createDefaultStubRunners();
    let standardsCalls = 0;
    const standards: AgentRunner = async (inv) => {
      standardsCalls += 1;
      if (standardsCalls === 1) {
        return {
          status: "completed",
          summary: formatMockNote("Non-compliant"),
          payload: {
            agentRole: "standards",
            compliant: false,
            deviations: [
              {
                id: "DEV-1",
                severity: "high",
                summary: formatMockNote("Policy gap"),
                policyRef: "northwind-kyc-baseline",
              },
            ],
            policiesChecked: ["northwind-kyc-baseline"],
          },
          evidence: [],
          mocksUsed: [{ mocked: true as const, mockLabel: "standards-test" }],
        };
      }
      return stubs.standards(inv);
    };

    const lead2 = new LeadOrchestrator({
      store: createInMemoryStore(),
      enableRemediation: true,
      maxRemediationCycles: 1,
      prClient: { client: createMockPrClient({ startNumber: 500 }) },
      runners: { standards },
    });

    const report = await lead2.startOnDemandCheck({
      goal: "Audit trail coverage",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
    });

    const actions = new Set(report.run.auditTrail.map((e) => e.action));
    for (const required of [
      "run.created",
      "agent.invoked",
      "mock.integration_used",
      "checkpoint.failed",
      "remediation.cycle_started",
      "checkpoint.passed",
      "pr.tracked",
      "pr.status_polled",
      "pr.merge_blocked",
      "human.approval_requested",
      "run.completed",
    ] as const) {
      expect(actions.has(required)).toBe(true);
    }

    // Polling interface works after completion (read-only snapshots).
    const polled = await lead2.pollPullRequestStatus(report.runId);
    expect(polled.length).toBeGreaterThanOrEqual(1);
    expect(polled[0]!.lastStatus?.humanMergeGateRequired).toBe(true);

    // silence unused lead from outer store construction
    expect(lead).toBeDefined();
  });

  it("never auto-merges even when human merge gate is approved on live run", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({ store, enableRemediation: false });
    const run = await store.create({
      goal: "merge gate",
      target: { repository: "vishamathur/mvp-releasedesk" },
      metadata: { approvals: { gates: [] }, pullRequests: { pullRequests: [] } },
    });
    const gate = await lead.requestApproval(run.runId, "merge", "test merge");
    const { gate: decided } = await lead.recordHumanApproval(run.runId, gate.id, "approved", {
      decidedBy: "dm",
    });
    expect(decided.status).toBe("approved");
    const events = (await store.get(run.runId))!.auditTrail.map((e) => e.action);
    expect(events).toContain("pr.merge_blocked");
  });
});
