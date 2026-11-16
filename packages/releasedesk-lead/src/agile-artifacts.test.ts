import { describe, expect, it } from "vitest";
import { createInMemoryStore, formatMockNote } from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";
import { createDefaultStubRunners } from "./stub-runners.js";
import type { AgentRunner } from "./agent-runner.js";
import { evaluateTestGate, createMockWorkspaceSuiteRunner } from "./test-gate.js";
import { buildReleaseNotesPackage } from "./release-notes.js";
import { buildRollbackPlan } from "./rollback.js";
import { createMockObservabilitySink, summarizeObservability } from "./observability.js";
import { assessReadiness } from "./readiness.js";
import { createMockPrClient } from "./pr/index.js";

describe("agile SDLC artifacts", () => {
  it("evaluates a passing MOCK workspace test gate without builder", async () => {
    const gate = await evaluateTestGate({
      tasks: [],
      repository: "vishamathur/mvp-releasedesk",
      workspaceSuite: createMockWorkspaceSuiteRunner(),
    });
    expect(gate.status).toBe("passed");
    expect(gate.blocking).toBe(false);
    expect(gate.checks.find((c) => c.id === "workspace_suite")?.mocked).toBe(true);
    expect(gate.checks.find((c) => c.id === "builder_tests")?.status).toBe("skipped");
  });

  it("fails test gate when workspace suite fails", async () => {
    const gate = await evaluateTestGate({
      tasks: [],
      repository: "vishamathur/mvp-releasedesk",
      workspaceSuite: createMockWorkspaceSuiteRunner({
        status: "failed",
        summary: formatMockNote("typecheck failed"),
      }),
    });
    expect(gate.status).toBe("failed");
    expect(gate.blocking).toBe(true);
  });

  it("builds release notes from change analyst output", () => {
    const pkg = buildReleaseNotesPackage({
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "feature",
      goal: "Ship KYC hardening",
      tasks: [
        {
          id: "task_ca",
          runId: "run_notes",
          name: "Change analysis",
          agentRole: "change_analyst",
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dependsOn: [],
          evidence: [],
          retry: { attempt: 0, maxAttempts: 1 },
          output: {
            releaseNotesDraft: "## Notes\n- KYC risk rules",
            overallImpact: "medium",
            commitsReviewed: 3,
            findings: [
              {
                path: "apps/kyc",
                changeType: "modified",
                impact: "medium",
                summary: "Risk scoring tweak",
              },
            ],
          },
        },
      ],
    });
    expect(pkg.status).toBe("ready_for_review");
    expect(pkg.highlights).toHaveLength(1);
    expect(pkg.bodyMarkdown).toContain("KYC risk rules");
    expect(pkg.overallImpact).toBe("medium");
  });

  it("recommends rollback when security blockers exist", () => {
    const plan = buildRollbackPlan({
      repository: "vishamathur/mvp-releasedesk",
      headRef: "bad-head",
      releaseTag: "v0.1.0",
      previousReleaseTag: "v0.0.9",
      tasks: [
        {
          id: "task_sec",
          runId: "run_rb",
          name: "Security",
          agentRole: "security",
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dependsOn: [],
          evidence: [],
          retry: { attempt: 0, maxAttempts: 1 },
          output: { releaseBlockingCount: 2, riskLevel: "high" },
        },
        {
          id: "task_ca",
          runId: "run_rb",
          name: "Change analysis",
          agentRole: "change_analyst",
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dependsOn: [],
          evidence: [],
          retry: { attempt: 0, maxAttempts: 1 },
          output: { overallImpact: "low" },
        },
      ],
    });
    expect(plan.status).toBe("recommended");
    expect(plan.riskLevel).toBe("high");
    expect(plan.previousReleaseTag).toBe("v0.0.9");
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.mocked).toBe(false);
  });

  it("records observability events on a mock sink", () => {
    const sink = createMockObservabilitySink();
    sink.emit({
      kind: "run.started",
      runId: "run_1",
      message: "started",
      mocked: true,
    });
    sink.emit({
      kind: "run.completed",
      runId: "run_1",
      message: "done",
      metrics: { durationMs: 12 },
      mocked: true,
    });
    const summary = summarizeObservability(sink.list(), {
      mode: "mock",
      durationMs: 12,
      readiness: "needs_human",
    });
    expect(summary.eventCount).toBe(2);
    expect(summary.kinds["run.started"]).toBe(1);
    expect(summary.mocked).toBe(true);
  });

  it("Lead run packages test gate, release notes, rollback, observability", async () => {
    const store = createInMemoryStore();
    const sink = createMockObservabilitySink();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      observability: sink,
      prClient: { client: createMockPrClient() },
      workspaceSuite: createMockWorkspaceSuiteRunner(),
    });

    const report = await lead.startOnDemandCheck({
      goal: "Agile artifact packaging",
      target: {
        repository: "vishamathur/mvp-releasedesk",
        baseRef: "main",
        headRef: "HEAD",
        releaseTag: "v0.1.0",
      },
      metadata: { previousReleaseTag: "v0.0.9" },
    });

    expect(report.testGates.gates).toHaveLength(1);
    expect(report.testGates.gates[0]!.status).toBe("passed");
    expect(report.releaseNotes.packages).toHaveLength(1);
    expect(report.releaseNotes.packages[0]!.status).toBe("ready_for_review");
    expect(report.rollback.plans).toHaveLength(1);
    expect(report.rollback.plans[0]!.previousReleaseTag).toBe("v0.0.9");
    expect(report.observability.summary.eventCount).toBeGreaterThanOrEqual(3);
    expect(report.observability.summary.readiness).toBe("needs_human");

    const actions = new Set(report.run.auditTrail.map((e) => e.action));
    expect(actions.has("test_gate.evaluated")).toBe(true);
    expect(actions.has("release_notes.generated")).toBe(true);
    expect(actions.has("rollback.plan_created")).toBe(true);
    expect(actions.has("observability.event_emitted")).toBe(true);
  });

  it("failed test gate blocks readiness", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      workspaceSuite: createMockWorkspaceSuiteRunner({
        status: "failed",
        summary: formatMockNote("suite red"),
      }),
    });

    const report = await lead.startOnDemandCheck({
      goal: "Red suite",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
    });

    expect(report.testGates.gates[0]!.status).toBe("failed");
    expect(
      report.leadOutput.blockingIssues.some((b) => b.includes("Test gate failed")),
    ).toBe(true);

    const reassessment = assessReadiness({
      tasks: report.run.tasks,
      approvals: report.approvals,
      checkpoints: report.checkpoints,
      testGates: report.testGates,
    });
    expect(reassessment.blockingIssues.some((b) => b.includes("Test gate failed"))).toBe(true);
  });

  it("builder testsPassed=false fails the automated test gate", async () => {
    const stubs = createDefaultStubRunners();
    const failingBuilder: AgentRunner = async (inv) => {
      const base = await stubs.builder(inv);
      return {
        ...base,
        payload: {
          ...base.payload,
          testsPassed: false,
        },
      };
    };

    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: true,
      maxRemediationCycles: 1,
      runners: {
        ...stubs,
        security: async (inv) => {
          const base = await stubs.security(inv);
          return {
            ...base,
            payload: {
              ...base.payload,
              releaseBlockingCount: 1,
              riskLevel: "high",
              findings: [
                {
                  id: "sec-1",
                  title: "Blocker",
                  severity: "high",
                  summary: formatMockNote("force remediation"),
                },
              ],
            },
          };
        },
        builder: failingBuilder,
      },
      workspaceSuite: createMockWorkspaceSuiteRunner(),
    });

    const report = await lead.startOnDemandCheck({
      goal: "Builder tests red",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
    });

    const builderCheck = report.testGates.gates[0]?.checks.find((c) => c.id === "builder_tests");
    expect(builderCheck?.status).toBe("failed");
    expect(report.testGates.gates[0]!.status).toBe("failed");
  });
});
