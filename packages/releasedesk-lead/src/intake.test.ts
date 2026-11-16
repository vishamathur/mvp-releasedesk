import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import {
  createCustomerIntake,
  createInMemoryIntakeStore,
} from "./intake.js";

describe("CustomerIntake → Lead gate", () => {
  async function seed() {
    const runStore = createInMemoryStore();
    const { intake, lead } = createCustomerIntake({
      store: runStore,
      intakeStore: createInMemoryIntakeStore(),
      enableRemediation: false,
      enablePrWorkflow: false,
    });

    const enqueued = await intake.enqueue({
      customer: {
        customerId: "cust_northwind",
        name: "Northwind Bank",
        weight: 1,
      },
      request: {
        title: "Intake gated change",
        summary: "Must dual-approve before Lead",
        requestedBy: "cs",
      },
      cost: {
        amount: 9000,
        direction: "charge",
        label: "MOCK estimate",
      },
    });

    return { intake, lead, runStore, enqueued };
  }

  it("cannot start Lead without queue approval", async () => {
    const { intake, enqueued } = await seed();
    await intake.approveCost(enqueued.cost.id, "approved", {
      decidedBy: "finance",
    });
    await expect(
      intake.startLeadFromApprovedQueueItem(enqueued.item.id),
    ).rejects.toThrow(/queue_approval/);
  });

  it("cannot start Lead without cost approval", async () => {
    const { intake, enqueued } = await seed();
    await intake.approveQueueItem(enqueued.item.id, "approved", {
      decidedBy: "dm",
    });
    await expect(
      intake.startLeadFromApprovedQueueItem(enqueued.item.id),
    ).rejects.toThrow(/cost approval/);
  });

  it("rejected stays blocked from Lead", async () => {
    const { intake, enqueued } = await seed();
    await intake.approveCost(enqueued.cost.id, "approved", {
      decidedBy: "finance",
    });
    await intake.approveQueueItem(enqueued.item.id, "rejected", {
      decidedBy: "dm",
    });
    await expect(
      intake.startLeadFromApprovedQueueItem(enqueued.item.id),
    ).rejects.toThrow(/rejected/);
  });

  it("both approvals clear allows Lead start (Security still routed)", async () => {
    const { intake, enqueued } = await seed();
    await intake.approveQueueItem(enqueued.item.id, "approved", {
      decidedBy: "dm",
    });
    await intake.approveCost(enqueued.cost.id, "approved", {
      decidedBy: "finance",
    });

    const { report, queue } = await intake.startLeadFromApprovedQueueItem(
      enqueued.item.id,
    );

    expect(report.runId).toMatch(/^run_/);
    expect(report.run.metadata.intake).toMatchObject({
      queueItemId: enqueued.item.id,
      customerId: "cust_northwind",
      costEstimateId: enqueued.cost.id,
    });
    const item = queue.items.find((i) => i.id === enqueued.item.id)!;
    expect(item.status).toBe("in_dev");
    expect(item.runId).toBe(report.runId);

    // Mandatory Security still present on the Lead path
    const roles = new Set(report.delegations.map((d) => d.agentRole));
    expect(roles.has("security")).toBe(true);

    const actions = report.run.auditTrail.map((e) => e.action);
    expect(actions).toContain("intake.lead_started_from_queue");
  });

  it("reorder without sign-off rejected; signed-off reorder accepted", async () => {
    const { intake } = await seed();
    await intake.enqueue({
      customer: { customerId: "cust_contoso", name: "Contoso", weight: 1 },
      request: {
        title: "Second customer request",
        summary: "Fairness neighbor",
        requestedBy: "cs",
      },
      cost: { amount: 1000, direction: "spend" },
    });

    const view = await intake.view();
    const ids = view.items.map((v) => v.item.id);

    await expect(intake.reorder({ orderedItemIds: [...ids].reverse() })).rejects.toThrow(
      /re-prioritize sign-off/,
    );

    const ok = await intake.reorder({
      orderedItemIds: [...ids].reverse(),
      signOff: { signedOffBy: "dm", notes: "swap" },
    });
    expect(ok.signOff.signedOffBy).toBe("dm");
  });

  it("estimate carries customerId across enqueue", async () => {
    const { enqueued } = await seed();
    expect(enqueued.cost.customerId).toBe("cust_northwind");
    expect(enqueued.request.customerId).toBe("cust_northwind");
    expect(enqueued.item.customerId).toBe("cust_northwind");
  });
});
