import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import { LeadOrchestrator, getPendingGates } from "@releasedesk/lead";
import { createSpecialistRunners } from "./runners.js";
import { defaultWorkspaceRoot } from "./paths.js";

describe("Lead + specialist runners integration", () => {
  it("runs real specialists through Lead and records independent task results", async () => {
    const store = createInMemoryStore();
    const runners = createSpecialistRunners({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
      assumeLeadHumanGates: true,
    });

    const lead = new LeadOrchestrator({
      store,
      runners,
      enableRemediation: false,
    });

    const report = await lead.startOnDemandCheck({
      goal: "M4 integration — specialist agents",
      target: {
        repository: "vishamathur/mvp-releasedesk",
        baseRef: "main",
        headRef: "HEAD",
      },
      trigger: { requestedBy: "integration-test" },
    });

    expect(report.run.status).toBe("completed");
    expect(report.leadOutput.readiness).toBe("needs_human");
    expect(getPendingGates(report.approvals).length).toBe(2);

    const specialists = report.run.tasks.filter((t) => t.agentRole !== "lead");
    expect(specialists.length).toBeGreaterThanOrEqual(3);
    expect(specialists.every((t) => t.status === "completed")).toBe(true);

    const byRole = Object.fromEntries(specialists.map((t) => [t.agentRole, t]));
    expect(byRole.change_analyst?.output?.releaseNotesDraft).toBeTruthy();
    expect(Array.isArray(byRole.change_analyst?.output?.findings)).toBe(true);
    expect(byRole.change_analyst?.evidence.length).toBeGreaterThan(0);

    expect(byRole.standards?.output?.compliant).toBe(true);
    expect(byRole.standards?.evidence.some((e) => e.kind === "policy_ref")).toBe(true);

    expect(byRole.security?.output?.releaseBlockingCount).toBe(0);
    expect(byRole.security?.evidence.some((e) => e.mock?.mocked)).toBe(true);

    // Not empty stub summaries
    expect(String(byRole.change_analyst?.output?.summary ?? "")).not.toMatch(/stub/i);
    expect(String(byRole.standards?.output?.summary ?? "")).not.toMatch(/stub/i);

    const actions = new Set(report.run.auditTrail.map((e) => e.action));
    expect(actions.has("task.completed")).toBe(true);
    expect(actions.has("human.approval_requested")).toBe(true);
  });
});
