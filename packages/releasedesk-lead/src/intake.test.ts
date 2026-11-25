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
        label: "Delivery estimate",
        source: "billing_system",
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

  it("reorder without sign-off rejected; signed-off reorder accepted", async () => {
    const { intake } = await seed();
    await intake.enqueue({
      customer: { customerId: "cust_contoso", name: "Contoso", weight: 1 },
      request: {
        title: "Second customer request",
        summary: "Fairness neighbor",
        requestedBy: "cs",
      },
      cost: { amount: 1000, direction: "spend", source: "billing_system" },
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
