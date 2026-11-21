import { describe, expect, it } from "vitest";
import {
  createInMemoryStore,
  evaluateIterationProceedGate,
  MANDATORY_SECURITY_ROLE,
} from "@releasedesk/core";
import { LeadOrchestrator } from "./orchestrator.js";

describe("Lead child sub-agents", () => {
  it("routes the default run onto the ER sprint and still schedules Security", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      enablePrWorkflow: false,
    });
    const report = await lead.startOnDemandCheck({
      goal: "Release readiness for Northwind KYC",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
    });

    expect(report.subAgents.status).toBe("completed");
    expect(report.subAgents.securityGateHeld).toBe(false);
    expect(report.subAgents.children.map((child) => child.id)).toEqual([
      "lead.intake-routing",
      "lead.kickoff",
      "lead.release-aggregation",
    ]);
    const kickoff = report.subAgents.children.find((child) => child.id === "lead.kickoff");
    expect(kickoff?.payload).toMatchObject({
      applied: false,
      track: "er_sprint",
      approved: false,
      feedsSprint: true,
    });
    expect(report.run.metadata.track).toBe("er_sprint");
    expect(report.delegations.some((item) => item.agentRole === MANDATORY_SECURITY_ROLE)).toBe(
      true,
    );
    expect(report.run.tasks.some((task) => task.agentRole === "security" && task.status === "completed")).toBe(
      true,
    );

    const gate = evaluateIterationProceedGate({ iterationId: report.runId, approvals: [] });
    expect(gate.canProceed).toBe(false);
  });

  it("opens a kickoff proposal for a new customer and feeds the same sprint", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      enablePrWorkflow: false,
    });
    const report = await lead.startOnDemandCheck({
      goal: "Onboard Northwind treasury",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
      metadata: { track: "new_customer_kickoff", customerId: "cust-treasury" },
    });

    const kickoff = report.subAgents.children.find((child) => child.id === "lead.kickoff");
    expect(kickoff?.payload).toMatchObject({
      applied: true,
      track: "new_customer_kickoff",
      humanApprovalRequired: true,
      approved: false,
      feedsSprint: true,
    });
    expect(String(kickoff?.payload.proposal ?? "")).toContain("human");
    expect(report.run.metadata.kickoff).toMatchObject({ approved: false, humanApprovalRequired: true });

    const security = report.run.tasks.find((task) => task.agentRole === "security");
    expect(security?.status).toBe("completed");
    expect(security?.input).toMatchObject({ track: "new_customer_kickoff" });
    expect(report.subAgents.children.some((child) => child.id === "lead.release-aggregation")).toBe(
      true,
    );
  });

  it("records a failed routing child without dropping the mandatory security task", async () => {
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      enableRemediation: false,
      enablePrWorkflow: false,
      subAgents: {
        timeoutMsById: { "lead.intake-routing": 40 },
        runOverrides: {
          "lead.intake-routing": () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ summary: "late", payload: {} }), 250);
            }),
        },
      },
    });
    const report = await lead.startOnDemandCheck({
      goal: "Release readiness",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });

    expect(report.subAgents.status).toBe("failed");
    expect(report.subAgents.timedOutIds).toContain("lead.intake-routing");
    expect(report.subAgents.securityGateHeld).toBe(false);
    expect(report.run.tasks.some((task) => task.agentRole === "security" && task.status === "completed")).toBe(
      true,
    );
    const gate = evaluateIterationProceedGate({ iterationId: report.runId, approvals: [] });
    expect(gate.canProceed).toBe(false);
    expect(gate.hasRedTeamApproval).toBe(false);
    expect(gate.hasSecurityApproval).toBe(false);
  });
});
